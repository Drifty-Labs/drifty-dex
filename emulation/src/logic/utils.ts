/** The minimum possible tick index. */
export const MIN_TICK = -887272;
/** The maximum possible tick index. */
export const MAX_TICK = 887272;

/** The base price used for calculating tick prices. */
export const BASE_PRICE = 1.0001;
export const QUOTE_PRICE = Math.pow(BASE_PRICE, -1);
/** The number of ticks that correspond to a 10% price change. */
export const TEN_PERCENT_TICKS = 954;

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
