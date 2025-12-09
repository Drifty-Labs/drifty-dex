import { assert } from "@std/assert";
import { Pool } from "../pool.ts";
import { ECs } from "../ecs.ts";

Deno.test("Pool: Overall reserve stays the same", () => {
    const pool = new Pool(111111, 100, false, {
        baseQty: ECs.fromString("1_00"),
        quoteQty: ECs.fromString("100_000_000"),
    });
    const overallBaseReserveBefore = pool.overallReserve.base;
    const overallQuoteReserveBefore = pool.overallReserve.quote;

    let p = pool.clone(false);

    p.swap({
        direction: "base -> quote",
        qtyIn: ECs.fromString("20"),
    });

    const overallBaseReserveAfter1 = p.overallReserve.base;
    const overallQuoteReserveAfter1 = p.overallReserve.quote;

    assert(overallBaseReserveBefore.le(overallBaseReserveAfter1));
    assert(overallQuoteReserveBefore.le(overallQuoteReserveAfter1));

    p = pool.clone(false);

    p.swap({
        direction: "quote -> base",
        qtyIn: ECs.fromString("20_000"),
    });

    const overallBaseReserveAfter2 = p.overallReserve.base;
    const overallQuoteReserveAfter2 = p.overallReserve.quote;

    assert(overallBaseReserveBefore.le(overallBaseReserveAfter2));
    assert(overallQuoteReserveBefore.le(overallQuoteReserveAfter2));
});
