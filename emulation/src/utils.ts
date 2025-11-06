export type AMMStats = {
    reserve: {
        total: number;
        unallocated: number;
        allocated: number;
    };
    inventory: {
        total: number;
    };
};

export function calcImpermanentLoss(
    stats: AMMStats,
    priceAdjusted: number
): number {
    const expected = stats.reserve.total * priceAdjusted;
    const actual =
        (stats.reserve.allocated + stats.reserve.unallocated) * priceAdjusted +
        stats.inventory.total;

    return 1 - actual / expected;
}

export const MIN_TICK = -887272;
export const MAX_TICK = 887272;

export const BASE_PRICE = 1.0001;

export function tickToPrice(tick: number): number {
    return Math.pow(BASE_PRICE, tick);
}

export type TwoSided<T> = {
    base: T;
    quote: T;
};

export function twoSided<T>(base: T, quote: T): TwoSided<T> {
    return {
        base,
        quote,
    };
}

export function panic(msg?: string): never {
    throw new Error(`Panicked: ${msg}`);
}
