/** The minimum possible tick index. */
export const MIN_TICK = -552626;
/** The maximum possible tick index. */
export const MAX_TICK = 552626;

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

export function chunkify<T>(arr: readonly T[], chunks: number): T[][] {
    if (!Number.isInteger(chunks) || chunks <= 0) {
        throw new RangeError("`chunks` must be a positive integer.");
    }

    const n = arr.length;
    const base = Math.floor(n / chunks);
    const rem = n % chunks;

    const out: T[][] = new Array(chunks);
    let i = 0;

    for (let c = 0; c < chunks; c++) {
        const size = base + (c < rem ? 1 : 0);
        out[c] = arr.slice(i, i + size);
        i += size;
    }
    return out;
}
