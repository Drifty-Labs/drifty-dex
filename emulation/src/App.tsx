import { createEffect, createSignal } from "solid-js";
import { LiquidityChart } from "./components/LiquidityChart.tsx";
import { Pool } from "./logic/pool.ts";

const pool = new Pool(1000);
pool.deposit("base", 10000);
pool.deposit("quote", 11000);

pool.swap({ direction: "base -> quote", qtyIn: 15 });
pool.swap({ direction: "quote -> base", qtyIn: 10 });

function App() {
    const [liquidity, setLiquidity] = createSignal(pool.getLiquidity(100));

    return (
        <main class="relative w-dvw h-dvh flex flex-col items-center bg-bg">
            <div class="flex flex-col">
                <LiquidityChart liquidity={liquidity()} />
            </div>
        </main>
    );
}

export default App;
