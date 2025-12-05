import { Inventory } from "./liquidity.ts";
import { panic } from "./utils.ts";

const base: bigint = 1_0000_0000n;
const basen: number = 1_0000_0000;

export class E8s {
    constructor(private _val: bigint) {}

    public toString() {
        const whole = this._val / base;
        const fraction = this._val - whole;

        return `${whole}.${fraction.toString().padStart(8, "0")}`;
    }

    public add(other: E8s): E8s {
        return E8s._add(this, other);
    }

    public static _add(a: E8s, b: E8s): E8s {
        return new E8s(a._val + b._val);
    }

    public sub(other: E8s): E8s {
        return E8s._sub(this, other);
    }

    public static _sub(a: E8s, b: E8s): E8s {
        return new E8s(a._val - b._val);
    }

    public mul(other: E8s): E8s {
        return E8s._mul(this, other);
    }

    public static _mul(a: E8s, b: E8s): E8s {
        return new E8s((a._val * b._val) / base);
    }

    public div(other: E8s): E8s {
        return E8s._div(this, other);
    }

    public static _div(a: E8s, b: E8s): E8s {
        if (b._val === 0n) panic("Division by zero");

        return new E8s((a._val * base) / b._val);
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

    public static fromNumber(n: number): E8s {
        const val = n > 0 ? Math.floor(n * basen) : Math.ceil(n * basen);

        return new E8s(BigInt(val));
    }

    public static one(): E8s {
        return new E8s(base);
    }

    public static two(): E8s {
        return new E8s(base * 2n);
    }

    public static zero(): E8s {
        return new E8s(0n);
    }

    public get raw() {
        return this._val;
    }
}
