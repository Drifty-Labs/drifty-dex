import { createSignal, onMount } from "solid-js";
import { Pool, type SwapArgs } from "../logic/pool.ts";
import {
    generateNextDayPivotTick,
    generateTodayTargetQuoteVolume,
    generateTrade,
} from "../logic/trade-gen.ts";
import { delay, panic } from "../logic/utils.ts";
import { LiquidityChart } from "./LiquidityChart.tsx";
import { ECs } from "../logic/ecs.ts";
import { Beacon } from "../logic/beacon.ts";

const CURRENT_TICK = 114445; // 93323 USDC per 1 BTC | 4 Dec 2025
const INIT_TICKS = 1000; // +-10% around cur price

const BTC_QTY = "100"; // from uniswap WBTC/USDT | 4 Dec 2025
const USD_QTY = "9_000_000"; // from uniswap WBTC/USDT | 4 Dec 2025
const AVG_DAILY_VOLUME = "24_300_000"; // from uniswap WBTC/USDT | 4 Dec 2025
const AVG_DAILY_VOLATILITY = "0.0006666"; // ~2% monthly, according to https://bitbo.io/volatility/ | 4 Dec 2025
const UNISWAP_APR = 0.3279; // WBTC/USDT | 4 Dec 2025

let POOL = new Pool(CURRENT_TICK, INIT_TICKS, false, {
    baseQty: ECs.fromString(BTC_QTY),
    quoteQty: ECs.fromString(USD_QTY),
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
        quoteVolume: ECs.zero(),
        pivotTick: CURRENT_TICK,
        targetQuoteVolume: generateTodayTargetQuoteVolume(
            ECs.fromString(AVG_DAILY_VOLUME)
        ),
        fees: ECs.zero(),
    });

    const [_avgSlippage24h, setAvgSlippage24h] = createSignal<ECs[]>([]);

    const addSlippage = (slippage: ECs) => {
        setAvgSlippage24h((s) => {
            s.push(slippage);
            return [...s];
        });
    };

    const avgSlippage24h = () => {
        const s100 = _avgSlippage24h();
        if (s100.length === 0) return ECs.zero();

        return s100
            .reduce((prev, cur) => prev.add(cur), ECs.zero())
            .div(s100.length);
    };

    const [_avgTradeSize24h, setAvgTradeSize24h] = createSignal<ECs[]>([]);

    const addTradeQuote = (tradeQuote: ECs) => {
        setAvgTradeSize24h((t) => {
            t.push(tradeQuote);
            return [...t];
        });
    };

    const avgTradeSize24h = () => {
        const t100 = _avgTradeSize24h();
        if (t100.length === 0) return ECs.zero();

        return t100
            .reduce((prev, cur) => prev.add(cur), ECs.zero())
            .div(t100.length);
    };

    const [fees29d, setFees29d] = createSignal<ECs[]>([]);

    const avgFees30d = () => {
        const f29d = fees29d();
        const fToday = today().fees;

        if (fToday.isZero() && f29d.length === 0) return ECs.zero();

        return f29d
            .reduce((prev, cur) => prev.add(cur), ECs.zero())
            .add(fToday)
            .div(f29d.length + (fToday.isZero() ? 0 : 1));
    };

    const [volume29d, setVolume29d] = createSignal<ECs[]>([]);

    const avgVolume30d = () => {
        const v29d = volume29d();
        const vToday = today().quoteVolume;

        if (vToday.isZero() && v29d.length === 0) return ECs.zero();

        return v29d
            .reduce((prev, cur) => prev.add(cur), ECs.zero())
            .add(vToday)
            .div(v29d.length + (vToday.isZero() ? 0 : 1));
    };

    const nextDay = (vol: ECs, f: ECs) => {
        setToday(({ day, quoteVolume, targetQuoteVolume, pivotTick, fees }) => {
            quoteVolume.addAssign(vol);
            fees.addAssign(f);

            if (quoteVolume.lt(targetQuoteVolume))
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
            quoteVolume = ECs.zero();
            fees = ECs.zero();
            targetQuoteVolume = stats()
                .quote.actualReserve.add(stats().quote.expectedReserveFromExit)
                .mul(10)
                .div(4);
            pivotTick = generateNextDayPivotTick({
                todayVolatility: ECs.fromString(AVG_DAILY_VOLATILITY),
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
                  todayVolatility: ECs.fromString(AVG_DAILY_VOLATILITY),
                  todayPivotTick: t.pivotTick,
              });

        const cp = POOL.clone(false);

        try {
            const quoteVolume =
                args.direction === "base -> quote"
                    ? args.qtyIn.mul(Beacon.base().price(cp.curAbsoluteTick))
                    : args.qtyIn.clone();

            const baseReserveBefore = cp.overallReserve.base;
            const quoteReserveBefore = cp.overallReserve.quote;

            const { qtyOut, feeFactor, feesIn, slippage } = cp.swap(args);
            POOL = cp;

            /*        console.log(
                `Swap: ${
                    args.direction === "base -> quote"
                        ? `${args.qtyIn} BASE -> ${qtyOut} QUOTE`
                        : `${args.qtyIn} QUOTE -> ${qtyOut} BASE`
                }; slippage=${slippage}`
            ); */

            const statsAfter = cp.stats;
            const baseReserveAfter = cp.overallReserve.base;
            const quoteReserveAfter = cp.overallReserve.quote;

            if (baseReserveAfter.lt(baseReserveBefore)) {
                panic(
                    `Base reserve has decreased! (after - before = ${baseReserveAfter
                        .sub(baseReserveBefore)
                        .toString()})`
                );
            }

            if (quoteReserveAfter.lt(quoteReserveBefore)) {
                panic(
                    `Quote reserve has decreased! (after - before = ${quoteReserveAfter
                        .sub(quoteReserveBefore)
                        .toString()})`
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

        const reserveNow = s.quote.actualReserve.add(
            s.quote.expectedReserveFromExit
        );

        const reserveThen = ORIGINAL_STATS.quote.depositedReserve;

        return reserveNow.sub(reserveThen);
    };

    const baseProfit = () => {
        const s = stats();

        const reserveNow = s.base.actualReserve.add(
            s.base.expectedReserveFromExit
        );

        const reserveThen = ORIGINAL_STATS.base.depositedReserve;

        return reserveNow.sub(reserveThen);
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
                        Daily Volume (avg. 30d): $
                        {avgVolume30d().toShortString()}
                    </p>
                    <p>
                        Daily Fees (avg. 30d): ${avgFees30d().toShortString()}
                    </p>
                    <p>
                        Fee % (real-time): {feeFactor().mul(100).toString(2)}%
                    </p>
                    <p>
                        Slippage % (avg. 24h):{" "}
                        {avgSlippage24h().mul(100).toString(2)}%
                    </p>
                    <p>
                        Trade Size (avg. 24h): $
                        {avgTradeSize24h().toShortString()}
                    </p>
                </div>

                <div class="flex flex-row justify-between">
                    <div class="flex flex-col gap-2">
                        <h3>USD AMM</h3>
                        <p>
                            Reserve: $
                            {stats().quote.actualReserve.toShortString()}
                        </p>
                        <p>
                            Inventory: $
                            {stats().quote.respectiveReserve.toShortString()}
                        </p>
                        <p>
                            Impermanent Loss: {il().quote.mul(100).toString(2)}%
                        </p>
                        <p>Total Profit: ${quoteProfit().toShortString()}</p>
                    </div>

                    <div class="flex flex-col gap-2">
                        <h3>BTC AMM</h3>
                        <p>
                            Reserve: ₿
                            {stats().base.actualReserve.toShortString()}
                        </p>
                        <p>
                            Inventory: ₿
                            {stats().base.respectiveReserve.toShortString()}
                        </p>
                        <p>
                            Impermanent Loss: {il().base.mul(100).toString(2)}%
                        </p>
                        <p>Total Profit: ₿{baseProfit().toShortString()}</p>
                    </div>
                </div>
            </div>
        </div>
    );
}
