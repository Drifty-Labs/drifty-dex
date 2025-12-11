/** The minimum possible tick index. */
export const MIN_TICK = -887272;
/** The maximum possible tick index. */
export const MAX_TICK = 887272;

/**
 * A generic type for representing two-sided objects, such as AMMs for the base and quote assets.
 */
export type TwoSided<T> = {
    base: T;
    quote: T;
};

export type TwoAmmSided<T> = {
    reserve: T;
    inventory: T;
};

/**
 * The side of the pool, either `base` or `quote`.
 */
export type Side = keyof TwoSided<unknown>;

export type AMMSide = keyof TwoAmmSided<unknown>;

export type DriftingStatus = "drifting" | "stable";

/**
 * The direction of a swap, either `base -> quote` or `quote -> base`.
 */
export type SwapDirection = "base -> quote" | "quote -> base";

export type AMMSwapDirection = "reserve -> inventory" | "inventory -> reserve";

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

export function xor(a: boolean, b: boolean): boolean {
    return (!a && b) || (a && !b);
}
