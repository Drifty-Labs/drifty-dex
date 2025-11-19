import { assertEquals, assertThrows } from "@std/assert";
import { InventoryRange, ReserveRange } from "../range.ts";
import { TickIndex } from "../ticks.ts";

const base = (idx: number) => new TickIndex(false, idx);

Deno.test("ReserveRange distributes uniformly", () => {
    const range = new ReserveRange(100, base(0), base(4));

    const best = range.takeBest();
    const worst = range.takeWorst();

    assertEquals(best.qty, worst.qty);
    assertEquals(best.tickIdx.index(), 4);
    assertEquals(worst.tickIdx.index(), 0);
});

Deno.test("ReserveRange stretch enforces bounds", () => {
    const range = new ReserveRange(50, base(0), base(1));
    range.stretchToRight(base(3));
    assertEquals(range.width, 4);
    assertThrows(() => range.stretchToRight(base(2)));
});

Deno.test("InventoryRange best/worst quantities", () => {
    const range = new InventoryRange(100, base(1), base(3));

    const best = range.takeBest();
    const worst = range.takeWorst();

    assertEquals(best.tickIdx.index(), 1);
    assertEquals(worst.tickIdx.index(), 3);
    assertEquals(best.qty * Math.pow(1.0001, range.width - 1), worst.qty);
});

Deno.test("InventoryRange putBest requires matching tick", () => {
    const range = new InventoryRange(10, base(2), base(3));
    range.putBest(5, base(1));
    assertEquals(range.takeBest().tickIdx.index(), 1);
    assertThrows(() => range.putBest(1, base(5)));
});
