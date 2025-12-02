import { createSignal, onMount, Show } from "solid-js";
import { LiquidityChart } from "./components/LiquidityChart.tsx";
import { Pool, type SwapDirection } from "./logic/pool.ts";
import { MAX_TICK, MIN_TICK, type Side } from "./logic/utils.ts";

const START_TICK = 114000;
const VISIBLE_TICKS = 200;
const INIT_TICKS = 100;

let pool = new Pool(START_TICK, INIT_TICKS, {
    baseQty: 11.2,
    quoteQty: 1_000_000,
});

const tradeSize: { s: number; p: number }[] = [
    { s: 0, p: 0 },
    { s: 0.01, p: 0.5 },
    { s: 0.05, p: 0.8 },
    { s: 0.1, p: 0.95 },
    { s: 0.2, p: 0.99 },
];

const calcQtyIn = (direction: SwapDirection, pool: Pool) => {
    const side: Side = direction === "base -> quote" ? "base" : "quote";
    const reserve = pool.getDepositedReserves()[side];

    const r = Math.random();
    let sCur = 0.01;

    for (const { s, p } of tradeSize) {
        if (r <= p) {
            sCur = s;
            break;
        }
    }

    return Math.random() * sCur * reserve;
};

const tickchange: { c: number; p: number }[] = [
    { c: 0, p: 0 },
    { c: 0, p: 0.6 },
    { c: 0.01, p: 0.7 },
    { c: 0.05, p: 0.9 },
    { c: 0.1, p: 0.99 },
    { c: 0.2, p: 0.999 },
    { c: 0.4, p: 0.9999 },
    { c: 0.8, p: 0.99999 },
];

const newTargetTick = (oldTick: number) => {
    const r = Math.random();
    let cCur = 0;

    for (const { c, p } of tickchange) {
        if (r <= p) {
            cCur = c;
            break;
        }
    }

    const sign = Math.random() > 0.5 ? 1 : -1;

    let newTick = Math.floor(oldTick + sign * Math.random() * oldTick);
    if (newTick >= MAX_TICK || newTick <= MIN_TICK) {
        newTick = Math.floor(oldTick + sign * -1 * Math.random() * oldTick);
    }

    return newTick;
};

function App() {
    const [liquidity, setLiquidity] = createSignal(pool.getLiquidityDigest());
    const [stats, setStats] = createSignal(pool.getStats());
    const [targetTick, setTargetTick] = createSignal(START_TICK);
    const [int, setInt] = createSignal<number | undefined>(undefined);

    const swap = (direction?: SwapDirection, qtyIn?: number) => {
        const curTick = pool.getCurAbsoluteTick();

        direction = direction
            ? direction
            : curTick === targetTick()
            ? Math.random() > 0.5
                ? "base -> quote"
                : "quote -> base"
            : curTick > targetTick()
            ? "base -> quote"
            : "quote -> base";

        qtyIn = qtyIn === undefined ? calcQtyIn(direction, pool) : qtyIn;

        const cp = pool.clone();

        try {
            cp.swap({ direction, qtyIn });
            pool = cp;
        } catch (e) {
            console.error("Bad swap, resetting...", e);
        }

        setLiquidity(pool.getLiquidityDigest());
        setStats(pool.getStats());
        setTargetTick(newTargetTick);
    };

    onMount(() => {
        (window as any).swap = swap;
    });

    const handleRunClick = () => {
        if (int()) {
            clearInterval(int());
            setInt(undefined);
        } else {
            setInt(setInterval(swap, 50));
        }
    };

    const handleBtQ = () => {
        swap("base -> quote");
    };

    const handleQtB = () => {
        swap("quote -> base");
    };

    const handleStateClick = () => {
        console.log(pool);
    };

    return (
        <main class="relative w-dvw h-dvh flex flex-col gap-20 items-center bg-bg">
            <div class="flex flex-col relative">
                <LiquidityChart
                    liquidity={liquidity()}
                    containerWidth={1000}
                    containerHeight={500}
                />
            </div>

            <div class="flex flex-col gap-2 text-white">
                <div>
                    Base:{" "}
                    {stats().base.respectiveReserve +
                        stats().base.actualReserve}
                </div>
                <div>
                    Quote:{" "}
                    {stats().quote.respectiveReserve +
                        stats().quote.actualReserve}
                </div>
            </div>

            <div class="flex flex-row gap-5">
                <button
                    type="submit"
                    class="bg-white text-black"
                    onclick={handleRunClick}
                >
                    {int() ? "Stop" : "Start"}
                </button>
                <Show when={!int()}>
                    <button
                        type="submit"
                        class="bg-white text-black"
                        onclick={handleBtQ}
                    >
                        Base to quote
                    </button>
                    <button
                        type="submit"
                        class="bg-white text-black"
                        onclick={handleQtB}
                    >
                        Quote to base
                    </button>
                </Show>
                <button
                    type="submit"
                    class="bg-white text-black"
                    onclick={handleStateClick}
                >
                    State
                </button>
            </div>
        </main>
    );
}

export default App;
