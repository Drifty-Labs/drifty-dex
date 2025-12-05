/** The minimum possible tick index. */
export const MIN_TICK = -887272;
/** The maximum possible tick index. */
export const MAX_TICK = 887272;

/** The base price used for calculating tick prices. */
export const BASE_PRICE = 1.0001;
export const QUOTE_PRICE = Math.pow(BASE_PRICE, -1);

export function priceToTick(price: number) {
    return Math.floor(Math.log(price) / Math.log(BASE_PRICE));
}

export function absoluteTickToPrice(
    absoluteTick: number,
    side: Side,
    kind: "reserve" | "inventory"
): number {
    if (side === "base") {
        return kind === "reserve"
            ? Math.pow(BASE_PRICE, absoluteTick)
            : Math.pow(QUOTE_PRICE, absoluteTick);
    } else {
        return kind === "reserve"
            ? Math.pow(QUOTE_PRICE, absoluteTick)
            : Math.pow(BASE_PRICE, absoluteTick);
    }
}

/**
 * A generic type for representing two-sided objects, such as AMMs for the base and quote assets.
 */
export type TwoSided<T> = {
    base: T;
    quote: T;
};

/**
 * The side of the pool, either `base` or `quote`.
 */
export type Side = keyof TwoSided<unknown>;
/**
 * The direction of a swap, either `base -> quote` or `quote -> base`.
 */
export type SwapDirection = "base -> quote" | "quote -> base";

/**
 * A helper function for creating a `TwoSided` object.
 * @param base The base asset.
 * @param quote The quote asset.
 * @returns A `TwoSided` object.
 */
export function twoSided<T>(base: T, quote: T): TwoSided<T> {
    return {
        base,
        quote,
    };
}

/**
 * A utility function for throwing an error and stopping execution.
 * @param msg The error message.
 */
export function panic(msg?: string): never {
    throw new Error(`Panicked: ${msg}`);
}

export function almostEq(
    a: number,
    b: number,
    eps: number = 0.00000001
): boolean {
    return Math.abs(a - b) < eps;
}

export function delay(ms: number) {
    return new Promise((res) => setTimeout(res, ms));
}

const T = 1_000_000_000_000;
const B = 1_000_000_000;
const M = 1_000_000;
const K = 1_000;

export function tokensToStr(qty: number): string {
    const absQty = Math.abs(qty);
    const sign = qty / absQty;
    const whole = Math.floor(absQty);
    const fraction = (absQty - whole).toFixed(8).substring(2);

    let res = "";

    if (Math.abs(whole) >= T) {
        res = (whole / T).toFixed(2) + "T";
    } else if (Math.abs(whole) >= B) {
        res = (whole / B).toFixed(2) + "B";
    } else if (Math.abs(whole) >= M) {
        res = (whole / M).toFixed(2) + "M";
    } else if (Math.abs(whole) >= K) {
        res = (whole / K).toFixed(2) + "K";
    } else if (Math.abs(whole) >= 100) {
        res = `${whole}.${fraction.substring(0, 2)}`;
    } else if (Math.abs(whole) >= 10) {
        res = `${whole}.${fraction.substring(0, 3)}`;
    } else {
        res = `${whole}.${fraction.substring(0, 4)}`;
    }

    res = sign < 0 ? "-" + res : res;

    return res;
}
