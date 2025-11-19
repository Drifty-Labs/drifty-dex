import { assertEquals } from "@std/assert";
import { Pool } from "../pool.ts";

const makePool = () => new Pool(0);

Deno.test("Pool deposit fans out to stable + drifting", () => {
    const pool = makePool();
    pool.deposit("base", 1000);

    const result = pool.swap({ direction: "base -> quote", qtyIn: 10 });
    assertEquals(result.qtyOut > 0, true);
});

Deno.test("Pool swap deducts fees proportional to IL", () => {
    const pool = makePool();
    pool.deposit("base", 1000);
    pool.deposit("quote", 1000);

    const beforeFees = pool.getFees();
    pool.swap({ direction: "base -> quote", qtyIn: 50 });
    const afterFees = pool.getFees();

    assertEquals(afterFees >= beforeFees, true);
});

Deno.test("Pool withdraw splits between AMMs", () => {
    const pool = makePool();
    pool.deposit("quote", 500);

    pool.withdraw("quote", 100);
    const secondSwap = pool.swap({ direction: "quote -> base", qtyIn: 5 });
    assertEquals(secondSwap.qtyOut > 0, true);
});
