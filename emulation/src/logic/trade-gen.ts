import { CURRENT_TICK } from "../components/Simulation.tsx";
import { BASE_PRICE, ECs, basePriceAbsoluteToTick } from "./ecs.ts";
import { Pool, type SwapArgs } from "./pool.ts";
import { panic, type SwapDirection } from "./utils.ts";

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
    let w: number;

    if (curTick < left || curTick > right) {
        if (curTick < left) {
            direction = "quote -> base";
            left = curTick;
            w = right - left + 1;
        } else {
            direction = "base -> quote";
            right = curTick;
            w = right - left + 1;
        }
    } else {
        const width = right - left + 1;
        const quoteWidth = curTick - left;
        const quoteP = quoteWidth / width;

        const r = Math.random();
        direction = r <= quoteP ? "base -> quote" : "quote -> base";

        if (direction === "base -> quote") {
            w = quoteWidth;
        } else {
            w = right - curTick + 1;
        }
    }

    let qtyIn =
        direction === "base -> quote"
            ? ECs.fromString("0.1")
            : ECs.fromString("10000");

    const minQtyIn =
        direction === "base -> quote"
            ? ECs.fromString("0.001")
            : ECs.fromString("100");

    while (true) {
        const priceChange = args.pool.estimatePriceImpactTicks({
            direction,
            qtyIn,
        });
        if (priceChange <= w) break;

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
    todayVolatility: ECs;
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

    if (left <= CURRENT_TICK && right >= CURRENT_TICK) {
        const r = Math.random();
        return r < 0.5 ? left : right;
    }

    if (left > CURRENT_TICK) {
        const r = Math.random();
        return r < 0.99 ? left : right;
    }

    const r = Math.random();
    return r < 0.99 ? right : left;
}

export type GenerateTodayVolumeArgs = {
    avgDailyQuoteVolume: ECs;
};

export type GenerateTodayVolumeResult = {
    todayTargetQuoteVolume: ECs;
};

export function generateTodayTargetQuoteVolume(avgDailyQuoteVolume: ECs): ECs {
    return avgDailyQuoteVolume.mul(ECs.random().mul(2));
}

function volatilityToTickVolatility(vol: ECs): number {
    const leftPrice = BASE_PRICE.clone();
    const rightPrice = leftPrice.mul(ECs.one().add(vol));
    const rightTick = basePriceAbsoluteToTick(rightPrice);

    if (rightTick < 1)
        panic(
            `Right tick should be greater than BASE_TICK: ${rightPrice} ${rightTick}`
        );

    return rightTick - 1;
}
