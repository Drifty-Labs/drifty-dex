const base: bigint = 1_0000_0000n;
const basen: number = 1_0000_0000;

export class E8s {
    constructor(private _val: bigint) {}

    public clone() {
        return new E8s(this._val);
    }

    public toString(decimals: number = 8) {
        const sign = this.sign();
        let whole = this._val / base;
        let fraction = this._val % base;

        if (sign === -1) {
            whole = -whole;
            fraction = -fraction;
        }

        return `${sign === -1 ? "-" : ""}${whole}.${fraction
            .toString()
            .padStart(8, "0")
            .substring(0, decimals)}`;
    }

    public toShortString() {
        let res = "";

        const t = E8s.b(1_000_000_000_000n);
        const b = E8s.b(1_000_000_000n);
        const m = E8s.b(1_000_000n);
        const k = E8s.b(1_000n);
        const h = E8s.b(100n);
        const s = E8s.b(10n);

        const a = this.abs();

        if (a.ge(t)) {
            res = this.div(t).toString(2) + "T";
        } else if (a.ge(b)) {
            res = this.div(b).toString(2) + "B";
        } else if (a.ge(m)) {
            res = this.div(m).toString(2) + "M";
        } else if (a.ge(k)) {
            res = this.div(k).toString(2) + "K";
        } else if (a.ge(h)) {
            res = this.toString(2);
        } else if (a.ge(s)) {
            res = this.toString(3);
        } else {
            res = this.toString(4);
        }

        return res;
    }

    public toNumber(): number {
        return E8s._toNumber(this);
    }

    public static _toNumber(a: E8s): number {
        const whole = a._val / base;
        const fraction = a._val % base;

        return Number(whole) + Number(fraction) / basen;
    }

    public add(other: E8s): E8s {
        return E8s._add(this, other);
    }

    public addAssign(other: E8s) {
        this._val += other._val;
    }

    public static _add(a: E8s, b: E8s): E8s {
        return new E8s(a._val + b._val);
    }

    public sub(other: E8s): E8s {
        return E8s._sub(this, other);
    }

    public subAssign(other: E8s) {
        this._val -= other._val;
    }

    public static _sub(a: E8s, b: E8s): E8s {
        return new E8s(a._val - b._val);
    }

    public mul(other: E8s | number): E8s {
        return E8s._mul(this, other);
    }

    public mulAssign(other: E8s | number) {
        this._val =
            typeof other === "number"
                ? this._val * BigInt(other)
                : (this._val * other._val) / base;
    }

    public static _mul(a: E8s, b: E8s | number): E8s {
        return new E8s(
            typeof b === "number"
                ? a._val * BigInt(b)
                : (a._val * b._val) / base
        );
    }

    public div(other: E8s | number): E8s {
        return E8s._div(this, other);
    }

    public divAssign(other: E8s | number) {
        this._val =
            typeof other === "number"
                ? this._val / BigInt(other)
                : (this._val * base) / other._val;
    }

    public static _div(a: E8s, b: E8s | number): E8s {
        return new E8s(
            typeof b === "number"
                ? a._val / BigInt(b)
                : (a._val * base) / b._val
        );
    }

    public mod(other: E8s): E8s {
        return E8s._mod(this, other);
    }

    public modAssign(other: E8s) {
        this._val %= other._val;
    }

    public static _mod(a: E8s, b: E8s): E8s {
        return new E8s(a._val % b._val);
    }

    public sign(): -1 | 1 {
        return E8s._sign(this);
    }

    public static _sign(a: E8s): -1 | 1 {
        return a._val > 0n ? 1 : -1;
    }

    public inv(): E8s {
        return E8s._inv(this);
    }

    public static _inv(a: E8s): E8s {
        return E8s._div(E8s.one(), a);
    }

    public pow2(): E8s {
        return E8s._pow2(this);
    }

    public static _pow2(a: E8s): E8s {
        return E8s._mul(a, a);
    }

    public sqrt(): E8s {
        return E8s._sqrt(this);
    }

    public static _sqrt(a: E8s): E8s {
        const one = E8s.one();
        if (a.eq(one)) return a;

        let low = E8s.zero();
        let high = a;
        if (a.lt(one)) {
            low = a;
            high = one;
        }

        const eps = new E8s(1n);
        let dif = high.sub(low);

        while (dif.gt(eps)) {
            const mid = high.add(low).div(E8s.two());
            const mid2 = mid.pow2();

            if (mid2.eq(a)) return mid;
            else if (mid2.gt(a)) {
                high = mid;
            } else {
                low = mid;
            }

            dif = high.sub(low);
        }

        return low;
    }

    public pow(exp: number | bigint): E8s {
        return E8s._pow(this, exp);
    }

    public static _pow(x: E8s, _exp: number | bigint): E8s {
        const exp: bigint =
            typeof _exp === "number" ? BigInt(Math.floor(_exp)) : _exp;

        if (exp < 0n) {
            return x.inv().pow(-exp);
        } else if (exp === 0n) {
            return E8s.one();
        } else if (exp % 2n === 0n) {
            return x.pow2().pow(exp / 2n);
        } else {
            return x.mul(x.pow2().pow((exp - 1n) / 2n));
        }
    }

    public abs(): E8s {
        return E8s._abs(this);
    }

    public static _abs(a: E8s): E8s {
        return new E8s(a._val > 0n ? a._val : -a._val);
    }

    public negate(): E8s {
        return E8s._negate(this);
    }

    public static _negate(a: E8s): E8s {
        return new E8s(-a._val);
    }

    public isNegative(): boolean {
        return E8s._isNegative(this);
    }

    public static _isNegative(a: E8s): boolean {
        return a._val < 0n;
    }

    public isPositive(): boolean {
        return E8s._isPositive(this);
    }

    public static _isPositive(a: E8s): boolean {
        return a._val > 0n;
    }

    public isZero(): boolean {
        return E8s._isZero(this);
    }

    public static _isZero(a: E8s): boolean {
        return a._val === 0n;
    }

    public eq(other: E8s): boolean {
        return E8s._eq(this, other);
    }

    public static _eq(a: E8s, b: E8s): boolean {
        return a._val === b._val;
    }

    public lt(other: E8s): boolean {
        return E8s._lt(this, other);
    }

    public static _lt(a: E8s, b: E8s): boolean {
        return a._val < b._val;
    }

    public le(other: E8s): boolean {
        return E8s._le(this, other);
    }

    public static _le(a: E8s, b: E8s): boolean {
        return a._val <= b._val;
    }

    public gt(other: E8s): boolean {
        return E8s._gt(this, other);
    }

    public static _gt(a: E8s, b: E8s): boolean {
        return a._val > b._val;
    }

    public ge(other: E8s): boolean {
        return E8s._ge(this, other);
    }

    public static _ge(a: E8s, b: E8s): boolean {
        return a._val >= b._val;
    }

    public static n(n: number): E8s {
        const val = n > 0 ? Math.floor(n * basen) : Math.ceil(n * basen);

        return new E8s(BigInt(val));
    }

    public static b(b: bigint): E8s {
        return new E8s(b * base);
    }

    public static one(): E8s {
        return new E8s(base);
    }

    public static two(): E8s {
        return new E8s(base * 2n);
    }

    public static half(): E8s {
        return new E8s(base / 2n);
    }

    public static zero(): E8s {
        return new E8s(0n);
    }

    public static random(): E8s {
        const r = Math.random();
        return E8s.n(r);
    }

    public get raw() {
        return this._val;
    }
}
