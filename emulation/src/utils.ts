export const MIN_TICK = -887272;
export const MAX_TICK = 887272;

export const BASE_PRICE = 1.0001;
export const TEN_PERCENT_TICKS = 954;

export function tickToPrice(tick: number, side: Side): number {
    return side === "base"
        ? Math.pow(BASE_PRICE, tick)
        : 1 / Math.pow(BASE_PRICE, tick);
}

export function nextTick(tick: number, side: Side): number {
    return side === "base" ? tick + 1 : tick - 1;
}

export function prevTick(tick: number, side: Side): number {
    return side === "base" ? tick - 1 : tick + 1;
}

export type TwoSided<T> = {
    base: T;
    quote: T;
};

export type Side = keyof TwoSided<unknown>;
export type SwapDirection = "base -> quote" | "quote -> base";

export function twoSided<T>(base: T, quote: T): TwoSided<T> {
    return {
        base,
        quote,
    };
}

export function panic(msg?: string): never {
    throw new Error(`Panicked: ${msg}`);
}
