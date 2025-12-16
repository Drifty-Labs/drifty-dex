import { createEffect, createSignal, onCleanup, onMount } from "solid-js";
import { Pool, type SwapArgs } from "../logic/pool.ts";
import {
    generateNextDayPivotTick,
    generateTodayTargetQuoteVolume,
    generateTrade,
} from "../logic/trade-gen.ts";
import { delay, panic } from "../logic/utils.ts";
import { LiquidityChart } from "./LiquidityChart.tsx";
import { absoluteTickToPrice, ECs } from "../logic/ecs.ts";
import { Beacon } from "../logic/beacon.ts";

export const CURRENT_TICK = 114445; // 93323 USDC per 1 BTC | 4 Dec 2025
const INIT_TICKS = 1000; // +-10% around cur price

const BTC_QTY = "100"; // from uniswap WBTC/USDT | 4 Dec 2025
const USD_QTY = "9_000_000"; // from uniswap WBTC/USDT | 4 Dec 2025
const AVG_DAILY_VOLUME = "24_300_000"; // from uniswap WBTC/USDT | 4 Dec 2025

export let POOL = new Pool(CURRENT_TICK, INIT_TICKS, false, {
    baseQty: ECs.fromString(BTC_QTY),
    quoteQty: ECs.fromString(USD_QTY),
});

const ORIGINAL_STATS = POOL.stats;

export type Metrics = {
    day: number;
    curPrice: ECs;
    curFeeFactor: ECs;

    avgVolume: ECs;
    avgFees: ECs;
    avgTxnSize: ECs;
    avgAPR: ECs;
    avgSlippage: ECs;

    usdReserve: ECs;
    usdInventory: ECs;
    usdProfit: ECs;
    usdProfitPercent: ECs;
    usdIL: ECs;

    btcReserve: ECs;
    btcInventory: ECs;
    btcProfit: ECs;
    btcProfitPercent: ECs;
    btcIL: ECs;
};

export type SimulationProps = {
    updMetrics: (m: Metrics) => void;
    speed: number;
    volatility: number;
    isRunning: boolean;
    isSim: boolean;
};

export function Simulation(props: SimulationProps) {
    const isRunning = () => props.isRunning;
    const avgDailyVolatility = () =>
        ECs.fromString((props.volatility / 100).toFixed(2));
    const speed = () => props.speed;

    const [liquidity, setLiquidity] = createSignal(POOL.liquidityDigest);
    const [stats, setStats] = createSignal(ORIGINAL_STATS);
    const [il, setIl] = createSignal(POOL.il);
    const [feeFactor, setFeeFactor] = createSignal(POOL.feeFactor);
    const [opacity, setOpacity] = createSignal(
        window.scrollY === 0 ? 0.6 : 0.2
    );

    const [today, setToday] = createSignal({
        day: 1,
        quoteVolume: ECs.zero(),
        pivotTick: CURRENT_TICK,
        targetQuoteVolume: generateTodayTargetQuoteVolume(
            ECs.fromString(AVG_DAILY_VOLUME)
        ),
        fees: ECs.zero(),
    });
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
                todayPivotTick: pivotTick,
                todayVolatility: avgDailyVolatility(),
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

    const swap = (_args?: SwapArgs) => {
        const t = today();

        const args = _args
            ? _args
            : generateTrade({
                  pool: POOL,
                  todayVolatility: avgDailyVolatility(),
                  todayPivotTick: t.pivotTick,
              });

        const quoteVolume =
            args.direction === "base -> quote"
                ? args.qtyIn.mul(Beacon.base(POOL).price(POOL.curAbsoluteTick))
                : args.qtyIn.clone();

        const baseReserveBefore = POOL.overallReserve.base;
        const quoteReserveBefore = POOL.overallReserve.quote;

        const { feeFactor, feesIn, slippage } = POOL.swap(args);

        const statsAfter = POOL.stats;
        const baseReserveAfter = POOL.overallReserve.base;
        const quoteReserveAfter = POOL.overallReserve.quote;

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

        setLiquidity(POOL.liquidityDigest);
        setStats(statsAfter);
        setIl(POOL.il);
        setFeeFactor(feeFactor);

        nextDay(quoteVolume, feesIn);
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

    let chartParent!: HTMLDivElement;
    const [chartSize, setChartSize] = createSignal({
        w: 0,
        h: 0,
    });

    const handleResize = () => {
        setChartSize({
            w: chartParent.clientWidth,
            h: chartParent.clientHeight,
        });
    };

    const handleScroll = () => {
        if (window.scrollY === 0) {
            if (props.isSim) {
                setOpacity(0.6);
            } else {
                setOpacity(0.4);
            }
        } else {
            setOpacity(0.2);
        }
    };

    const [int, setInt] = createSignal<number | undefined>();

    createEffect(() => {
        if (window.scrollY === 0) {
            if (props.isSim) {
                setOpacity(0.6);
            } else {
                setOpacity(0.4);
            }
        } else {
            setOpacity(0.2);
        }
    });

    onMount(() => {
        setChartSize({
            w: chartParent.clientWidth,
            h: chartParent.clientHeight,
        });

        if (window.scrollY === 0) {
            if (props.isSim) {
                setOpacity(0.6);
            } else {
                setOpacity(0.4);
            }
        } else {
            setOpacity(0.2);
        }

        window.addEventListener("resize", handleResize);
        window.addEventListener("scroll", handleScroll);

        (window as any).swap = swap;

        setInt(
            setInterval(() => {
                if (props.updMetrics) {
                    props.updMetrics({
                        day: today().day,

                        curPrice: absoluteTickToPrice(
                            POOL.curAbsoluteTick,
                            "base",
                            "reserve"
                        ),
                        curFeeFactor: feeFactor().mul(100),

                        avgAPR: avgFees30d()
                            .div(POOL.tvlQuote)
                            .mul(100 * 365),
                        avgVolume: avgVolume30d(),
                        avgFees: avgFees30d(),
                        avgTxnSize: avgTradeSize24h(),
                        avgSlippage: avgSlippage24h().mul(100),

                        usdReserve: stats().quote.actualReserve,
                        usdInventory: stats().quote.respectiveReserve,
                        usdProfit: quoteProfit(),
                        usdProfitPercent: quoteProfit()
                            .div(POOL.depositedReserves.quote)
                            .mul(100),
                        usdIL: il().quote.mul(100),

                        btcReserve: stats().base.actualReserve,
                        btcInventory: stats().base.respectiveReserve,
                        btcProfit: baseProfit(),
                        btcProfitPercent: baseProfit()
                            .div(POOL.depositedReserves.base)
                            .mul(100),
                        btcIL: il().base.mul(100),
                    });
                }
            }, 100)
        );
    });

    onMount(async () => {
        while (true) {
            if (isRunning()) swap();
            await delay(Math.floor(((101 - speed()) / 100) * 1000));
        }
    });

    onCleanup(() => {
        if (int())
            setInt((i) => {
                clearInterval(i);
                return undefined;
            });

        window.removeEventListener("resize", handleResize);
        window.removeEventListener("scroll", handleScroll);
    });

    return (
        <div
            class="fixed w-dvw h-dvh flex flex-col gap-10 transition-all bg-bg"
            style={{ opacity: opacity() }}
        >
            <div ref={chartParent} class="absolute w-dvw h-dvh overflow-hidden">
                <LiquidityChart
                    liquidity={liquidity()}
                    containerWidth={chartSize().w}
                    containerHeight={chartSize().h}
                />
            </div>
        </div>
    );
}
