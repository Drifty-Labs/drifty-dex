import { E8s } from "./ecs.ts";

/** The minimum possible tick index. */
export const MIN_TICK = -887272;
/** The maximum possible tick index. */
export const MAX_TICK = 887272;

/** The base price used for calculating tick prices. */
export const BASE_PRICE = new E8s(1_0001_0000n);
export const QUOTE_PRICE = BASE_PRICE.inv();

export function priceToTick(price: number) {
    return Math.floor(Math.log(price) / Math.log(BASE_PRICE.toNumber()));
}

export function absoluteTickToPrice(
    absoluteTick: number,
    side: Side,
    kind: "reserve" | "inventory"
): E8s {
    if (side === "base") {
        return kind === "reserve"
            ? BASE_PRICE.pow(absoluteTick)
            : QUOTE_PRICE.pow(absoluteTick);
    } else {
        return kind === "reserve"
            ? QUOTE_PRICE.pow(absoluteTick)
            : BASE_PRICE.pow(absoluteTick);
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

export function delay(ms: number) {
    return new Promise((res) => setTimeout(res, ms));
}
