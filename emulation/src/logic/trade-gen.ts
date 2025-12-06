import { E8s } from "./ecs.ts";
import { Pool, type SwapArgs } from "./pool.ts";
import { BASE_PRICE, panic, priceToTick, type SwapDirection } from "./utils.ts";

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
    const baseReserve = stats.base.actualReserve.add(
        stats.base.expectedReserveFromExit
    );
    const quoteReserve = stats.quote.actualReserve.add(
        stats.quote.expectedReserveFromExit
    );

    let qtyIn =
        direction === "base -> quote"
            ? baseReserve.div(10)
            : quoteReserve.div(10);
    const minQtyIn =
        direction === "base -> quote"
            ? E8s.n(1000).div(E8s.n(93000))
            : E8s.n(1000);

    while (true) {
        const poolCopy = args.pool.clone(true);

        poolCopy.swap({ direction, qtyIn });
        const nextTick = poolCopy.curAbsoluteTick;

        if (nextTick >= left && nextTick <= right) break;
        qtyIn.divAssign(2);

        if (qtyIn.lt(minQtyIn)) {
            qtyIn = minQtyIn;
            break;
        }
    }

    return { qtyIn, direction };
}

export type GenerateNextDayTickOptionsArgs = {
    todayPivotTick: number;
    todayVolatility: E8s;
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
    avgDailyQuoteVolume: E8s;
};

export type GenerateTodayVolumeResult = {
    todayTargetQuoteVolume: E8s;
};

export function generateTodayTargetQuoteVolume(avgDailyQuoteVolume: E8s): E8s {
    return avgDailyQuoteVolume.mul(E8s.random().mul(2));
}

function volatilityToTickVolatility(vol: E8s): number {
    const leftPrice = BASE_PRICE.clone();
    const rightPrice = leftPrice.mul(E8s.one().add(vol));
    const rightTick = priceToTick(rightPrice.toNumber());

    if (rightTick < 1)
        panic(
            `Right tick should be greater than BASE_TICK: ${rightPrice} ${rightTick}`
        );

    return rightTick - 1;
}
