import { assertEquals, assertThrows } from "@std/assert";
import { Inventory, InventoryTick, Reserve } from "../liquidity.ts";
import { TickIndex } from "../ticks.ts";

const base = (idx: number) => new TickIndex(false, idx);

Deno.test("Reserve init/withdraw lifecycle", () => {
    const reserve = new Reserve();
    reserve.init(100, base(-2), base(0));
    assertEquals(reserve.width, 3);

    reserve.put(50);
    const cut = reserve.withdrawCut(0.5);
    assertEquals(cut, 75);

    assertThrows(() => new Reserve().put(10));
});

Deno.test("Reserve take best/worst return ticks", () => {
    const reserve = new Reserve();
    reserve.init(60, base(-3), base(-1));

    const best = reserve.takeBest();
    const worst = reserve.takeWorst();

    assertEquals(best?.idx.index(), -1);
    assertEquals(worst?.idx.index(), -3);
});

Deno.test("Inventory tracks respective reserve", () => {
    const inventory = new Inventory();
    const tick: InventoryTick = { idx: base(2), inventory: 30 };
    inventory.putBest(tick);
    assertEquals(inventory.qty(), 30);

    const taken = inventory.takeBest(base(2));
    assertEquals(taken?.inventory, 30);
    assertEquals(inventory.qty(), 0);
});

Deno.test("Inventory takeBest respects voids", () => {
    const inventory = new Inventory();
    inventory.putBest({ idx: base(5), inventory: 40 });

    assertEquals(inventory.takeBest(base(4)), undefined);
    assertEquals(inventory.takeBest(base(5))?.inventory, 40);
});
