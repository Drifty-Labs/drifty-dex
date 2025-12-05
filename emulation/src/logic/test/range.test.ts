import { assertAlmostEquals } from "@std/assert";
import { InventoryRange } from "../range.ts";
import { absoluteTickToPrice } from "../utils.ts";

const eps = 0.00000001;

Deno.test("Inventory range produces uniform reserve range", () => {
    const base = new InventoryRange(1000, 1, 100, "base", false, false);

    const baseBest = base.peekBest();
    const baseWorst = base.peekWorst();

    const baseBestRespectiveReserve =
        baseBest.qty *
        absoluteTickToPrice(baseBest.tickIdx, "base", "inventory");
    const baseWorstRespectiveReserve =
        baseWorst.qty *
        absoluteTickToPrice(baseWorst.tickIdx, "base", "inventory");

    assertAlmostEquals(
        baseBestRespectiveReserve,
        baseWorstRespectiveReserve,
        eps
    );

    const quote = new InventoryRange(1000, 1, 100, "quote", false, false);

    const quoteBest = quote.peekBest();
    const quoteWorst = quote.peekWorst();

    const quoteBestRespectiveReserve =
        quoteBest.qty *
        absoluteTickToPrice(quoteBest.tickIdx, "quote", "inventory");
    const quoteWorstRespectiveReserve =
        quoteWorst.qty *
        absoluteTickToPrice(quoteWorst.tickIdx, "quote", "inventory");

    assertAlmostEquals(
        quoteBestRespectiveReserve,
        quoteWorstRespectiveReserve,
        eps
    );
});
