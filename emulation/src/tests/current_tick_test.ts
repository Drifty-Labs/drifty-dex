import { assertAlmostEquals, assertEquals, assertThrows } from "@std/assert";
import { CurrentTick, RecoveryBin } from "../cur-tick.ts";
import { Inventory, Reserve } from "../liquidity.ts";
import { TickIndex } from "../ticks.ts";

const baseTick = () => new TickIndex(false, 0);

Deno.test("CurrentTick deposits rebalance targets", () => {
    const reserve = new Reserve();
    reserve.init(0, baseTick().min(), baseTick());
    const inventory = new Inventory();
    const ct = new CurrentTick(baseTick(), reserve, inventory);

    ct.deposit(10);
    const idxPrice = ct.index().getPrice();

    const cut = ct.withdrawCut(0.5);
    assertEquals(cut.reserve, 5);
    assertAlmostEquals(cut.inventory, 5 * idxPrice);
});

Deno.test("CurrentTick swap recovers IL before consuming inventory", () => {
    const reserve = new Reserve();
    reserve.init(0, baseTick().min(), baseTick());
    const inventory = new Inventory();
    const ct = new CurrentTick(baseTick(), reserve, inventory);

    ct.addInventoryFees(5);
    const { qtyOut, reminderIn } = ct.swap({
        direction: "reserve -> inventory",
        qtyIn: 2,
    });

    assertEquals(reminderIn, 0);
    assertEquals(qtyOut, 2 * ct.index().getPrice());
});

Deno.test("CurrentTick increment/decrement guard state", () => {
    const reserve = new Reserve();
    reserve.init(100, baseTick().min(), baseTick());
    const inventory = new Inventory();
    const ct = new CurrentTick(baseTick(), reserve, inventory);

    assertThrows(() => ct.increment());
});

Deno.test("RecoveryBin withdrawCut shares collateral", () => {
    const reserve = new Reserve();
    reserve.init(0, baseTick().min(), baseTick());
    const inventory = new Inventory();
    const bin = new RecoveryBin(reserve, inventory);

    bin.addCollateral(10);
    const cut = bin.withdrawCut(0.25);
    assertEquals(cut, 2.5);
});
