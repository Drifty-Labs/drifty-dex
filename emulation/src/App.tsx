import { createEffect, createSignal, onMount } from "solid-js";
import { LiquidityChart } from "./components/LiquidityChart.tsx";
import { Pool, type SwapDirection } from "./logic/pool.ts";

let pool = new Pool(1000, { baseQty: 2000, quoteQty: 1000, tickSpan: 100 });

function App() {
    const [liquidity, setLiquidity] = createSignal(
        pool.getLiquidityDigest(100)
    );
    const [int, setInt] = createSignal<number | undefined>(undefined);

    const swap = () => {
        const direction: SwapDirection =
            Math.random() > 0.5 ? "base -> quote" : "quote -> base";

        const qtyIn = Math.random() * 500 + 500;

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

    const handleClick = () => {
        if (int()) {
            clearInterval(int());
            setInt(undefined);
        } else {
            setInt(setInterval(swap, 50));
        }
    };

    return (
        <main class="relative w-dvw h-dvh flex flex-col gap-20 items-center bg-bg">
            <div class="flex flex-col">
                <LiquidityChart liquidity={liquidity()} />
            </div>

            <button class="bg-white text-black" onclick={handleClick}>
                {int() ? "Stop" : "Start"}
            </button>
        </main>
    );
}

export default App;
