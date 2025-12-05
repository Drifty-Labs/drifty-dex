import { Pool, type SwapArgs } from "./pool.ts";
import {
    almostEq,
    BASE_PRICE,
    MAX_TICK,
    panic,
    priceToTick,
    type SwapDirection,
} from "./utils.ts";

export type GenerateTradeArgs = {
    pool: Pool;
} & GenerateNextDayTickOptionsArgs;

export function generateTrade(args: GenerateTradeArgs): SwapArgs {
    const curTick = args.pool.curAbsoluteTick;
    let { left, right } = generateNextDayPivotTickOptions({
        todayPivotTick: args.todayPivotTick,
        todayVolatility: args.todayVolatility,
    });

    let direction: SwapDirection | undefined = undefined;

    if (curTick < left || curTick > right) {
        if (curTick < left) {
            direction = "quote -> base";
            left = curTick;
        } else {
            direction = "base -> quote";
            right = curTick;
        }
    } else {
        const width = right - left + 1;
        const quoteWidth = curTick - left;
        const quoteP = quoteWidth / width;

        const r = Math.random();
        direction = r <= quoteP ? "base -> quote" : "quote -> base";
    }

    const stats = args.pool.stats;
    const baseReserve =
        stats.base.actualReserve + stats.base.expectedReserveFromExit;
    const quoteReserve =
        stats.quote.actualReserve + stats.quote.expectedReserveFromExit;

    let qtyIn =
        direction === "base -> quote" ? baseReserve * 0.1 : quoteReserve * 0.1;
    const minQtyIn = direction === "base -> quote" ? 1000 / 93000 : 1000;

    while (true) {
        const poolCopy = args.pool.clone(true);

        poolCopy.swap({ direction, qtyIn });
        const nextTick = poolCopy.curAbsoluteTick;

        if (nextTick >= left && nextTick <= right) break;
        qtyIn /= 2;

        if (qtyIn < minQtyIn) {
            qtyIn = minQtyIn;
            break;
        }
    }

    return { qtyIn, direction };
}

export type GenerateNextDayTickOptionsArgs = {
    todayPivotTick: number;
    todayVolatility: number;
};

export type GenerateNextDayTickOptionsResult = {
    left: number;
    right: number;
};

export function generateNextDayPivotTickOptions(
    args: GenerateNextDayTickOptionsArgs
): GenerateNextDayTickOptionsResult {
    const tickVolatility = volatilityToTickVolatility(args.todayVolatility);

    const left = args.todayPivotTick - tickVolatility;
    const right = args.todayPivotTick + tickVolatility;

    return { left, right };
}

export function generateNextDayPivotTick(
    args: GenerateNextDayTickOptionsArgs
): number {
    const { left, right } = generateNextDayPivotTickOptions(args);

    const r = Math.random();
    return r < 0.5 ? left : right;
}

export type GenerateTodayVolumeArgs = {
    avgDailyQuoteVolume: number;
};

export type GenerateTodayVolumeResult = {
    todayTargetQuoteVolume: number;
};

export function generateTodayTargetQuoteVolume(
    avgDailyQuoteVolume: number
): number {
    return avgDailyQuoteVolume * 2 * Math.random();
}

function volatilityToTickVolatility(vol: number): number {
    const leftPrice = BASE_PRICE;
    const rightPrice = leftPrice * (1 + vol);
    const rightTick = priceToTick(rightPrice);

    if (rightTick < 1)
        panic(
            `Right tick should be greater than BASE_TICK: ${rightPrice} ${rightTick}`
        );

    return rightTick - 1;
}
