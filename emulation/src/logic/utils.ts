/** The minimum possible tick index. */
export const MIN_TICK = -887272;
/** The maximum possible tick index. */
export const MAX_TICK = 887272;

/** The base price used for calculating tick prices. */
export const BASE_PRICE = 1.0001;
/** The number of ticks that correspond to a 10% price change. */
export const TEN_PERCENT_TICKS = 954;

import type { TickIndex } from "./ticks.ts";

/**
 * Converts an absolute tick index to a price for pool-level operations.
 * The returned price satisfies: `price * inputQty = outputQty`.
 *
 * @param absoluteTick The absolute tick index.
 * @param inputAsset The asset type of the input ("base" or "quote").
 * @returns The price such that multiplying by input quantity gives output quantity.
 *
 * @example
 * // Convert base to quote
 * const quoteQty = baseQty * absoluteTickToPrice(tick, "base");
 *
 * @example
 * // Convert quote to base
 * const baseQty = quoteQty * absoluteTickToPrice(tick, "quote");
 */
export function absoluteTickToPrice(
    absoluteTick: number,
    inputAsset: "base" | "quote"
): number {
    if (inputAsset === "base") {
        // base → quote: returns quote per base
        return Math.pow(BASE_PRICE, absoluteTick);
    } else {
        // quote → base: returns base per quote
        return Math.pow(BASE_PRICE, -absoluteTick);
    }
}

/**
 * Converts a TickIndex to a price for AMM-level operations.
 * The returned price satisfies: `price * inputQty = outputQty`.
 *
 * This function abstracts away the tick orientation (inverted for base AMM,
 * normal for quote AMM) and always returns the correct conversion factor.
 *
 * @param tick The TickIndex object (encapsulates orientation).
 * @param inputAsset The asset type of the input ("reserve" or "inventory").
 * @returns The price such that multiplying by input quantity gives output quantity.
 *
 * @example
 * // Convert reserve to inventory
 * const inventoryQty = reserveQty * tickToPrice(tick, "reserve");
 *
 * @example
 * // Convert inventory to reserve
 * const reserveQty = inventoryQty * tickToPrice(tick, "inventory");
 */
export function tickToPrice(
    tick: TickIndex,
    inputAsset: "reserve" | "inventory"
): number {
    if (inputAsset === "reserve") {
        // reserve → inventory: returns inventory per reserve
        return 1 / tick.price;
    } else {
        // inventory → reserve: returns reserve per inventory
        return tick.price;
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
