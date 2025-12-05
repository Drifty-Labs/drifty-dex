import { createSignal, onMount } from "solid-js";
import { Pool, type SwapArgs } from "../logic/pool.ts";
import {
    generateNextDayPivotTick,
    generateTodayTargetQuoteVolume,
    generateTrade,
} from "../logic/trade-gen.ts";
import {
    absoluteTickToPrice,
    almostEq,
    delay,
    panic,
    tokensToStr,
} from "../logic/utils.ts";
import { LiquidityChart } from "./LiquidityChart.tsx";

const CURRENT_TICK = 114445; // 93323 USDC per 1 BTC | 4 Dec 2025
const INIT_TICKS = 1000; // +-10% around cur price

const BTC_QTY = 100; // from uniswap WBTC/USDT | 4 Dec 2025
const USD_QTY = 9_000_000; // from uniswap WBTC/USDT | 4 Dec 2025
const AVG_DAILY_VOLUME = 24_300_000; // from uniswap WBTC/USDT | 4 Dec 2025
const AVG_DAILY_VOLATILITY = 0.0006666; // ~2% monthly, according to https://bitbo.io/volatility/ | 4 Dec 2025
const UNISWAP_APR = 0.3279; // WBTC/USDT | 4 Dec 2025

let POOL = new Pool(CURRENT_TICK, INIT_TICKS, false, {
    baseQty: BTC_QTY,
    quoteQty: USD_QTY,
});

const ORIGINAL_STATS = POOL.stats;

export function Simulation() {
    const [liquidity, setLiquidity] = createSignal(POOL.liquidityDigest);
    const [stats, setStats] = createSignal(ORIGINAL_STATS);
    const [il, setIl] = createSignal(POOL.il);
    const [feeFactor, setFeeFactor] = createSignal(POOL.feeFactor);

    const [isRunning, setRunning] = createSignal(true);

    const [today, setToday] = createSignal({
        day: 1,
        quoteVolume: 0,
        pivotTick: CURRENT_TICK,
        targetQuoteVolume: generateTodayTargetQuoteVolume(AVG_DAILY_VOLUME),
        fees: 0,
    });

    const [_avgSlippage24h, setAvgSlippage24h] = createSignal<number[]>([]);

    const addSlippage = (slippage: number) => {
        setAvgSlippage24h((s) => {
            s.push(slippage);
            return [...s];
        });
    };

    const avgSlippage24h = () => {
        const s100 = _avgSlippage24h();
        if (s100.length === 0) return 0;

        return s100.reduce((prev, cur) => prev + cur, 0) / s100.length;
    };

    const [_avgTradeSize24h, setAvgTradeSize24h] = createSignal<number[]>([]);

    const addTradeQuote = (tradeQuote: number) => {
        setAvgTradeSize24h((t) => {
            t.push(tradeQuote);
            return [...t];
        });
    };

    const avgTradeSize24h = () => {
        const t100 = _avgTradeSize24h();
        if (t100.length === 0) return 0;

        return t100.reduce((prev, cur) => prev + cur, 0) / t100.length;
    };

    const [fees29d, setFees29d] = createSignal<number[]>([]);

    const avgFees30d = () => {
        const f29d = fees29d();
        const fToday = today().fees;

        if (fToday === 0 && f29d.length === 0) return 0;

        return (
            (f29d.reduce((prev, cur) => prev + cur, 0) + fToday) /
            (f29d.length + (fToday === 0 ? 0 : 1))
        );
    };

    const [volume29d, setVolume29d] = createSignal<number[]>([]);

    const avgVolume30d = () => {
        const v29d = volume29d();
        const vToday = today().quoteVolume;

        if (vToday === 0 && v29d.length === 0) return 0;

        return (
            (v29d.reduce((prev, cur) => prev + cur, 0) + vToday) /
            (v29d.length + (vToday === 0 ? 0 : 1))
        );
    };

    const nextDay = (vol: number, f: number) => {
        setToday(({ day, quoteVolume, targetQuoteVolume, pivotTick, fees }) => {
            quoteVolume += vol;
            fees += f;

            if (quoteVolume < targetQuoteVolume)
                return {
                    day,
                    quoteVolume,
                    targetQuoteVolume,
                    pivotTick,
                    fees,
                };

            setVolume29d((v) => {
                if (v.length === 29) v.shift();
                v.push(quoteVolume);

                return [...v];
            });

            setFees29d((f) => {
                if (f.length === 29) f.shift();
                f.push(fees);

                return [...f];
            });

            day += 1;
            quoteVolume = 0;
            fees = 0;
            targetQuoteVolume =
                (stats().quote.actualReserve +
                    stats().quote.expectedReserveFromExit) *
                2.5;
            pivotTick = generateNextDayPivotTick({
                todayVolatility: AVG_DAILY_VOLATILITY,
                todayPivotTick: pivotTick,
            });

            setAvgSlippage24h([]);
            setAvgTradeSize24h([]);

            const d = {
                day,
                quoteVolume,
                targetQuoteVolume,
                pivotTick,
                fees,
            };

            return d;
        });
    };

    const swap = (_args?: SwapArgs) => {
        const t = today();

        const args = _args
            ? _args
            : generateTrade({
                  pool: POOL,
                  todayVolatility: AVG_DAILY_VOLATILITY,
                  todayPivotTick: t.pivotTick,
              });

        const cp = POOL.clone(false);

        try {
            const quoteVolume =
                args.direction === "base -> quote"
                    ? args.qtyIn *
                      absoluteTickToPrice(cp.curAbsoluteTick, "base", "reserve")
                    : args.qtyIn;

            const statsBefore = cp.stats;

            const { qtyOut, feeFactor, feesIn, slippage } = cp.swap(args);
            POOL = cp;

            const statsAfter = cp.stats;

            const baseReserveBefore =
                statsAfter.base.actualReserve +
                statsAfter.base.respectiveReserve;
            const baseReserveAfter =
                statsBefore.base.actualReserve +
                statsBefore.base.respectiveReserve;

            if (!almostEq(Math.abs(baseReserveBefore - baseReserveAfter), 0)) {
                panic(
                    `Base reserve has decreased! (after - before = ${(
                        baseReserveAfter - baseReserveBefore
                    ).toFixed(8)})`
                );
            }

            const quoteReserveBefore =
                statsAfter.quote.actualReserve +
                statsAfter.quote.respectiveReserve;
            const quoteReserveAfter =
                statsBefore.quote.actualReserve +
                statsBefore.quote.respectiveReserve;

            if (
                !almostEq(Math.abs(quoteReserveBefore - quoteReserveAfter), 0)
            ) {
                panic(
                    `Quote reserve has decreased! (after - before = ${(
                        quoteReserveAfter - quoteReserveBefore
                    ).toFixed(8)})`
                );
            }

            addTradeQuote(quoteVolume);
            addSlippage(slippage);

            setLiquidity(cp.liquidityDigest);
            setStats(statsAfter);
            setIl(cp.il);
            setFeeFactor(feeFactor);

            nextDay(quoteVolume, feesIn);
        } catch (e) {
            console.error("Bad swap, resetting...", e);
            if (isRunning()) setRunning(false);
        }
    };

    onMount(async () => {
        (window as any).swap = swap;

        while (true) {
            if (isRunning()) {
                swap();
            }

            await delay(10);
        }
    });

    const handleRunClick = () => {
        setRunning((r) => !r);
    };

    const quoteProfit = () => {
        const s = stats();

        const reserveNow =
            s.quote.actualReserve + s.quote.expectedReserveFromExit;

        const reserveThen = ORIGINAL_STATS.quote.depositedReserve;

        return reserveNow - reserveThen;
    };

    const baseProfit = () => {
        const s = stats();

        const reserveNow =
            s.base.actualReserve + s.base.expectedReserveFromExit;

        const reserveThen = ORIGINAL_STATS.base.depositedReserve;

        return reserveNow - reserveThen;
    };

    return (
        <div class="flex flex-col gap-20 w-5xl text-white">
            <div class="flex flex-col relative">
                <LiquidityChart
                    liquidity={liquidity()}
                    containerWidth={1000}
                    containerHeight={500}
                />
            </div>

            <div class="flex flex-row gap-5">
                <button
                    type="submit"
                    class="bg-white text-black"
                    onclick={handleRunClick}
                >
                    {isRunning() ? "Stop" : "Start"}
                </button>
                <button
                    type="submit"
                    class="bg-white text-black"
                    onclick={() => console.log(POOL.clone(true))}
                >
                    Pool State
                </button>
            </div>

            <div class="flex flex-col gap-y-10">
                <div class="flex flex-row gap-x-10 gap-y-2 flex-wrap">
                    <p>Day: {today().day}</p>
                    <p>
                        Daily Volume (avg. 30d): ${tokensToStr(avgVolume30d())}
                    </p>
                    <p>Daily Fees (avg. 30d): ${tokensToStr(avgFees30d())}</p>
                    <p>Fee % (real-time): {(feeFactor() * 100).toFixed(2)}%</p>
                    <p>
                        Slippage % (avg. 24h):{" "}
                        {(avgSlippage24h() * 100).toFixed(2)}%
                    </p>
                    <p>
                        Trade Size (avg. 24h): ${tokensToStr(avgTradeSize24h())}
                    </p>
                </div>

                <div class="flex flex-row justify-between">
                    <div class="flex flex-col gap-2">
                        <h3>USD AMM</h3>
                        <p>
                            Reserve: ${tokensToStr(stats().quote.actualReserve)}
                        </p>
                        <p>
                            Inventory: $
                            {tokensToStr(stats().quote.respectiveReserve)}
                        </p>
                        <p>
                            Impermanent Loss: {(il().quote * 100).toFixed(2)}%
                        </p>
                        <p>Total Profit: ${tokensToStr(quoteProfit())}</p>
                    </div>

                    <div class="flex flex-col gap-2">
                        <h3>BTC AMM</h3>
                        <p>
                            Reserve: ₿{tokensToStr(stats().base.actualReserve)}
                        </p>
                        <p>
                            Inventory: ₿
                            {tokensToStr(stats().base.respectiveReserve)}
                        </p>
                        <p>Impermanent Loss: {(il().base * 100).toFixed(2)}%</p>
                        <p>Total Profit: ₿{tokensToStr(baseProfit())}</p>
                    </div>
                </div>
            </div>
        </div>
    );
}
