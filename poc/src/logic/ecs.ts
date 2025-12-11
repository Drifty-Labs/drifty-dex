import { type AMMSide, MAX_TICK, MIN_TICK, panic, type Side } from "./utils.ts";

// e32s for maximum precision
const DECIMALS = 32;
const base: bigint = 1_0000_0000_0000_0000_0000_0000_0000_0000n;

const numBasePowM4: number = 1_0000_0000;
const bBasePowM4: bigint = 1_0000_0000n;

export class ECs {
    constructor(private _val: bigint) {}

    public clone() {
        return new ECs(this._val);
    }

    public static fromString(s: string): ECs {
        const parts = s.split(".");
        if (parts.length > 2) panic("Expecting a string in format '123.456'");

        const whole = BigInt(parts[0].replaceAll("_", ""));
        const fraction = parts[1]
            ? BigInt(parts[1].replaceAll("_", "").padEnd(DECIMALS, "0"))
            : 0n;

        return new ECs(whole * base + (whole >= 0n ? fraction : -fraction));
    }

    public toString(decimals: number = DECIMALS) {
        const sign = this.sign();
        let whole = this._val / base;
        let fraction = this._val % base;

        if (sign === -1) {
            whole = -whole;
            fraction = -fraction;
        }

        return `${sign === -1 ? "-" : ""}${whole}.${fraction
            .toString()
            .padStart(DECIMALS, "0")
            .substring(0, decimals)}`;
    }

    public toNumber() {
        const bn = this._val / bBasePowM4 / bBasePowM4 / bBasePowM4;
        const fraction = Number(bn % bBasePowM4) / numBasePowM4;
        const whole = Number(bn / bBasePowM4);

        return whole + fraction;
    }

    public toShortString() {
        let res = "";

        const t = ECs.b(1_000_000_000_000n);
        const b = ECs.b(1_000_000_000n);
        const m = ECs.b(1_000_000n);
        const k = ECs.b(1_000n);
        const h = ECs.b(100n);
        const s = ECs.b(10n);

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

    public add(other: ECs): ECs {
        return ECs._add(this, other);
    }

    public addAssign(other: ECs) {
        this._val += other._val;
    }

    public static _add(a: ECs, b: ECs): ECs {
        return new ECs(a._val + b._val);
    }

    public sub(other: ECs): ECs {
        return ECs._sub(this, other);
    }

    public subAssign(other: ECs) {
        this._val -= other._val;
    }

    public static _sub(a: ECs, b: ECs): ECs {
        return new ECs(a._val - b._val);
    }

    public mul(other: ECs | number): ECs {
        return ECs._mul(this, other);
    }

    public mulAssign(other: ECs | number) {
        this._val =
            typeof other === "number"
                ? this._val * BigInt(other)
                : (this._val * other._val) / base;
    }

    public static _mul(a: ECs, b: ECs | number): ECs {
        return new ECs(
            typeof b === "number"
                ? a._val * BigInt(b)
                : (a._val * b._val) / base
        );
    }

    public div(other: ECs | number): ECs {
        return ECs._div(this, other);
    }

    public divAssign(other: ECs | number) {
        this._val =
            typeof other === "number"
                ? this._val / BigInt(other)
                : (this._val * base) / other._val;
    }

    public static _div(a: ECs, b: ECs | number): ECs {
        return new ECs(
            typeof b === "number"
                ? a._val / BigInt(b)
                : (a._val * base) / b._val
        );
    }

    public mod(other: ECs): ECs {
        return ECs._mod(this, other);
    }

    public modAssign(other: ECs) {
        this._val %= other._val;
    }

    public static _mod(a: ECs, b: ECs): ECs {
        return new ECs(a._val % b._val);
    }

    public sign(): -1 | 1 {
        return ECs._sign(this);
    }

    public static _sign(a: ECs): -1 | 1 {
        return a._val >= 0n ? 1 : -1;
    }

    public inv(): ECs {
        return ECs._inv(this);
    }

    public static _inv(a: ECs): ECs {
        return ECs._div(ECs.one(), a);
    }

    public pow2(): ECs {
        return ECs._pow2(this);
    }

    public static _pow2(a: ECs): ECs {
        return ECs._mul(a, a);
    }

    public sqrt(): ECs {
        return ECs._sqrt(this);
    }

    public static _sqrt(a: ECs): ECs {
        const one = ECs.one();
        if (a.eq(one)) return a;

        let low = ECs.zero();
        let high = a;
        if (a.lt(one)) {
            low = a;
            high = one;
        }

        const eps = new ECs(1n);
        let dif = high.sub(low);

        while (dif.gt(eps)) {
            const mid = high.add(low).div(ECs.two());
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

    public pow(exp: number | bigint): ECs {
        return ECs._pow(this, exp);
    }

    public static _pow(x: ECs, _exp: number | bigint): ECs {
        const exp: bigint =
            typeof _exp === "number" ? BigInt(Math.floor(_exp)) : _exp;

        if (exp < 0n) {
            return x.inv().pow(-exp);
        } else if (exp === 0n) {
            return ECs.one();
        } else if (exp % 2n === 0n) {
            return x.pow2().pow(exp / 2n);
        } else {
            return x.mul(x.pow2().pow((exp - 1n) / 2n));
        }
    }

    public abs(): ECs {
        return ECs._abs(this);
    }

    public static _abs(a: ECs): ECs {
        return new ECs(a._val > 0n ? a._val : -a._val);
    }

    public negate(): ECs {
        return ECs._negate(this);
    }

    public static _negate(a: ECs): ECs {
        return new ECs(-a._val);
    }

    public isNegative(): boolean {
        return ECs._isNegative(this);
    }

    public static _isNegative(a: ECs): boolean {
        return a._val < 0n;
    }

    public isPositive(): boolean {
        return ECs._isPositive(this);
    }

    public static _isPositive(a: ECs): boolean {
        return a._val > 0n;
    }

    public isZero(): boolean {
        return ECs._isZero(this);
    }

    public static _isZero(a: ECs): boolean {
        return a._val === 0n;
    }

    public eq(other: ECs): boolean {
        return ECs._eq(this, other);
    }

    public almostEq(other: ECs): boolean {
        return ECs._almostEq(this, other);
    }

    public static _almostEq(a: ECs, b: ECs): boolean {
        if (a._val === b._val) return true;

        if (a._val > b._val) return a._val - b._val <= 1n;
        else return b._val - a._val <= 1n;
    }

    public static _eq(a: ECs, b: ECs): boolean {
        return a._val === b._val;
    }

    public lt(other: ECs): boolean {
        return ECs._lt(this, other);
    }

    public static _lt(a: ECs, b: ECs): boolean {
        return a._val < b._val;
    }

    public le(other: ECs): boolean {
        return ECs._le(this, other);
    }

    public static _le(a: ECs, b: ECs): boolean {
        return a._val <= b._val;
    }

    public gt(other: ECs): boolean {
        return ECs._gt(this, other);
    }

    public static _gt(a: ECs, b: ECs): boolean {
        return a._val > b._val;
    }

    public ge(other: ECs): boolean {
        return ECs._ge(this, other);
    }

    public static _ge(a: ECs, b: ECs): boolean {
        return a._val >= b._val;
    }

    public static b(b: bigint): ECs {
        return new ECs(b * base);
    }

    public static one(): ECs {
        return new ECs(base);
    }

    public static two(): ECs {
        return new ECs(base * 2n);
    }

    public static half(): ECs {
        return new ECs(base / 2n);
    }

    public static zero(): ECs {
        return new ECs(0n);
    }

    public static random(): ECs {
        const r = Math.random().toFixed(10);
        return ECs.fromString(r);
    }

    public get raw() {
        return this._val;
    }
}

/** The base price used for calculating tick prices. */
export const BASE_PRICE = ECs.fromString("1.0001");

export function basePriceAbsoluteToTick(price: ECs): number {
    if (price.isNegative()) panic("The price can't be negative");

    if (price.eq(ECs.one())) return 0;

    let left = price.lt(ECs.one()) ? MIN_TICK : 1,
        right = price.lt(ECs.one()) ? -1 : MAX_TICK;

    while (true) {
        const mid = Math.floor((left + right) / 2);

        const t = BASE_PRICE.pow(mid);

        if (t.eq(price)) return mid;
        if (Math.abs(right - left) <= 1) return mid;
        if (t.gt(price)) {
            right = mid;
        } else {
            left = mid;
        }
    }
}

export function absoluteTickToPrice(
    absoluteTick: number,
    side: Side,
    ammSide: AMMSide
): ECs {
    if (side === "base") {
        return ammSide === "reserve"
            ? BASE_PRICE.pow(absoluteTick)
            : ECs.one().div(BASE_PRICE.pow(absoluteTick));
    } else {
        return ammSide === "reserve"
            ? ECs.one().div(BASE_PRICE.pow(absoluteTick))
            : BASE_PRICE.pow(absoluteTick);
    }
}
