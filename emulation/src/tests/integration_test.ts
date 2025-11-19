import { assertEquals } from "@std/assert";
import { Pool } from "../pool.ts";

Deno.test("Integration: multi-swap keeps ticks aligned", () => {
    const pool = new Pool(0);
    pool.deposit("base", 1000);
    pool.deposit("quote", 1000);

    const directions = [
        { direction: "base -> quote", qtyIn: 5 },
        { direction: "quote -> base", qtyIn: 2 },
        { direction: "base -> quote", qtyIn: 10 },
    ] as const;

    for (const args of directions) {
        const { qtyOut } = pool.swap(args);
        assertEquals(qtyOut > 0, true);
        const ticks = [
            pool["stableAMM"].base.curTick().index().toAbsolute(),
            pool["stableAMM"].quote.curTick().index().toAbsolute(),
            pool["driftingAMM"].base.curTick().index().toAbsolute(),
            pool["driftingAMM"].quote.curTick().index().toAbsolute(),
        ];
        assertEquals(
            ticks.every((t) => t === ticks[0]),
            true
        );
    }
});
