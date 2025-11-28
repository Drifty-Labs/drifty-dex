import { createEffect, createSignal, onMount, Show } from "solid-js";
import { LiquidityChart } from "./components/LiquidityChart.tsx";
import { Pool, type SwapDirection } from "./logic/pool.ts";
import { absoluteTickToPrice, panic } from "./logic/utils.ts";

let pool = new Pool(1000, 90, false, { baseQty: 2000, quoteQty: 1000 });

const calculateSlippage = (direction: SwapDirection, qty: number) => {
    const p = pool.clone(true);

    try {
        const expected =
            qty *
            absoluteTickToPrice(
                p.getCurAbsoluteTick(),
                direction === "base -> quote" ? "base" : "quote"
            );
        const { qtyOut: actual } = p.swap({ direction, qtyIn: qty });

        if (actual > expected) panic("Slippage always exists");

        return 1 - actual / expected;
    } catch (e) {
        console.error(
            `Error while calculating slippage. ${direction} ${qty}`,
            e
        );
        return 1;
    }
};

const fitSlippage = (direction: SwapDirection, slippageTolerance: number) => {
    let qty =
        direction === "base -> quote"
            ? pool.getDepositedReserves().base
            : pool.getDepositedReserves().quote;

    while (true) {
        if (qty < 0.00000001) panic("Too high slippage");

        const slippage = calculateSlippage(direction, qty);
        if (slippage > slippageTolerance) {
            qty /= 2;
            continue;
        }

        break;
    }

    return qty;
};

function App() {
    const [liquidity, setLiquidity] = createSignal(
        pool.getLiquidityDigest(100)
    );
    const [stats, setStats] = createSignal(pool.getStats());
    const [int, setInt] = createSignal<number | undefined>(undefined);

    const swap = (direction?: SwapDirection) => {
        direction = direction
            ? direction
            : Math.random() > 0.5
            ? "base -> quote"
            : "quote -> base";

        const qtyIn = fitSlippage(direction, 0.05);

        const cp = pool.clone(false);

        try {
            cp.swap({ direction, qtyIn });
            pool = cp;
        } catch (e) {
            console.error("Bad swap, resetting...", e);
        }

        const liquidity = pool.getLiquidityDigest(100);

        setLiquidity(liquidity);
        setStats(pool.getStats());
    };

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
            <div class="flex flex-col">
                <LiquidityChart liquidity={liquidity()} />
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
                <button class="bg-white text-black" onclick={handleRunClick}>
                    {int() ? "Stop" : "Start"}
                </button>
                <Show when={!int()}>
                    <button class="bg-white text-black" onclick={handleBtQ}>
                        Base to quote
                    </button>
                    <button class="bg-white text-black" onclick={handleQtB}>
                        Quote to base
                    </button>
                </Show>
                <button class="bg-white text-black" onclick={handleStateClick}>
                    State
                </button>
            </div>
        </main>
    );
}

export default App;
