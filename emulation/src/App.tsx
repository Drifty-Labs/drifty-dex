import { createEffect, createSignal, onMount, Show } from "solid-js";
import { LiquidityChart } from "./components/LiquidityChart.tsx";
import { Pool, type SwapDirection } from "./logic/pool.ts";

let pool = new Pool(1000, { baseQty: 2000, quoteQty: 1000, tickSpan: 90 });

function App() {
    const [liquidity, setLiquidity] = createSignal(
        pool.getLiquidityDigest(100)
    );
    const [int, setInt] = createSignal<number | undefined>(undefined);

    onMount(() => {
        console.log(pool);
    });

    const swap = (direction?: SwapDirection) => {
        direction = direction
            ? direction
            : Math.random() > 0.5
            ? "base -> quote"
            : "quote -> base";

        const qtyIn = Math.random() * 50 + 50;

        const cp = pool.clone();

        try {
            pool.swap({ direction, qtyIn });
        } catch (e) {
            console.error("Bad swap, resetting...", e);
            pool = cp;
        }

        const liquidity = pool.getLiquidityDigest(100);

        setLiquidity(liquidity);
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

    return (
        <main class="relative w-dvw h-dvh flex flex-col gap-20 items-center bg-bg">
            <div class="flex flex-col">
                <LiquidityChart liquidity={liquidity()} />
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
            </div>
        </main>
    );
}

export default App;
