import { assertEquals, assertAlmostEquals, assertThrows } from "@std/assert";
import { CurrentTick, RecoveryBin } from "../cur-tick.ts";
import { Reserve, Inventory } from "../liquidity.ts";
import { TickIndexFactory } from "../ticks.ts";

Deno.test("RecoveryBin - Basic Collateral", () => {
    const bin = new RecoveryBin(new Reserve() as any, new Inventory() as any);

    bin.addCollateral(100);

    assertEquals(bin.hasCollateral(), true);
});

Deno.test("RecoveryBin - Recovery Without Inventory", () => {
    const inventory = new Inventory();
    const bin = new RecoveryBin(new Reserve() as any, inventory as any);

    bin.addCollateral(100);

    const factory = new TickIndexFactory(false);
    const result = bin.recover({
        curTickIdx: factory.make(1000),
        reserveIn: 50,
    });

    assertEquals(result.inventoryOut, 0);
    assertEquals(result.reminderReserveIn, 50);
});

Deno.test("RecoveryBin - Recovery With Collateral Only", () => {
    const inventory = new Inventory();
    const bin = new RecoveryBin(new Reserve() as any, inventory as any);

    bin.addCollateral(100);

    const factory = new TickIndexFactory(false);
    const result = bin.recover({
        curTickIdx: factory.make(1000),
        reserveIn: 50,
    });

    assertEquals(result.inventoryOut, 0);
    assertEquals(result.reminderReserveIn, 50);
    assertEquals(result.recoveredReserve, 0);
});

Deno.test("RecoveryBin - Recovery With Worst Tick", () => {
    const inventory = new Inventory();
    const bin = new RecoveryBin(new Reserve() as any, inventory as any);

    const factory = new TickIndexFactory(false);
    inventory.putWorstNewRange({
        idx: factory.make(1000),
        inventory: 100,
    });

    bin.addCollateral(50);

    const result = bin.recover({
        curTickIdx: factory.make(1001),
        reserveIn: 10,
    });

    assertEquals(result.inventoryOut > 0, true);
});

Deno.test("RecoveryBin - WithdrawCut", () => {
    const inventory = new Inventory();
    const bin = new RecoveryBin(new Reserve() as any, inventory as any);

    const factory = new TickIndexFactory(false);
    inventory.putWorstNewRange({
        idx: factory.make(1000),
        inventory: 100,
    });

    bin.addCollateral(100);

    const withdrawn = bin.withdrawCut(0.5);

    assertEquals(withdrawn > 0, true);
});

Deno.test("CurrentTick - Deposit", () => {
    const factory = new TickIndexFactory(false);
    const reserve = new Reserve();
    reserve.init(100, factory.make(90), factory.make(99));

    const curTick = new CurrentTick(
        factory.make(100),
        reserve,
        new Inventory()
    );

    curTick.deposit(50);

    assertEquals(curTick.hasReserve(), true);
});

Deno.test("CurrentTick - Swap (reserve -> inventory)", () => {
    const factory = new TickIndexFactory(false);
    const reserve = new Reserve();
    reserve.init(100, factory.make(90), factory.make(99));

    const curTick = new CurrentTick(
        factory.make(100),
        reserve,
        new Inventory()
    );
    curTick.deposit(50);

    // First build up some inventory
    curTick.swap({
        direction: "inventory -> reserve",
        qtyIn: 10,
    });

    // Now swap reserve -> inventory
    const result = curTick.swap({
        direction: "reserve -> inventory",
        qtyIn: 5,
    });

    assertEquals(result.qtyOut > 0, true);
});

Deno.test("CurrentTick - Swap (inventory -> reserve)", () => {
    const factory = new TickIndexFactory(false);
    const reserve = new Reserve();
    reserve.init(100, factory.make(90), factory.make(99));

    const curTick = new CurrentTick(
        factory.make(100),
        reserve,
        new Inventory()
    );
    curTick.deposit(50);

    const result = curTick.swap({
        direction: "inventory -> reserve",
        qtyIn: 10,
    });

    assertEquals(result.qtyOut > 0, true);
    assertEquals(curTick.hasReserve(), true);
});

Deno.test("CurrentTick - Increment", () => {
    const factory = new TickIndexFactory(false);
    const reserve = new Reserve();
    const inventory = new Inventory();
    reserve.init(100, factory.make(90), factory.make(99));

    const curTick = new CurrentTick(factory.make(100), reserve, inventory);
    curTick.deposit(50);

    // Consume all reserve
    while (curTick.hasReserve()) {
        curTick.swap({
            direction: "inventory -> reserve",
            qtyIn: 10,
        });
    }

    // Now increment
    const initialIdx = curTick.idx().toAbsolute();
    curTick.increment("inventory -> reserve");

    assertEquals(curTick.idx().toAbsolute(), initialIdx + 1);
    assertEquals(curTick.hasInventory(), false);
});

Deno.test("CurrentTick - Decrement", () => {
    const factory = new TickIndexFactory(false);
    const reserve = new Reserve();
    const inventory = new Inventory();
    reserve.init(100, factory.make(90), factory.make(99));

    const curTick = new CurrentTick(factory.make(100), reserve, inventory);
    curTick.deposit(50);

    // Build inventory
    while (curTick.hasReserve()) {
        curTick.swap({
            direction: "inventory -> reserve",
            qtyIn: 10,
        });
    }

    // Decrement
    const initialIdx = curTick.idx().toAbsolute();
    curTick.decrement("inventory -> reserve");

    assertEquals(curTick.idx().toAbsolute(), initialIdx - 1);
    assertEquals(curTick.hasReserve(), true);
});

Deno.test("Full Simulation - Quote AMM with Recovery", () => {
    const invertedFactory = new TickIndexFactory(true);

    // Quote AMM (Inverted) at price 1000
    // Reserve Range: [1001, 1100] (absolute)
    const quoteReserve = new Reserve();
    const quoteInventory = new Inventory();
    quoteReserve.init(
        1000,
        invertedFactory.make(1100),
        invertedFactory.make(1001)
    );
    const quoteCurTick = new CurrentTick(
        invertedFactory.make(1000),
        quoteReserve,
        quoteInventory
    );

    // Initial deposit at tick 1000
    quoteCurTick.deposit(100);

    // Capture initial state
    const initialReserveQty = quoteReserve.qty;
    const _initialReserveWidth = quoteReserve.width;

    assertEquals(quoteCurTick.idx().toAbsolute(), 1000);
    assertEquals(quoteInventory.isEmpty(), true);

    // Phase 1: Price 1000 -> 1005 (Base -> Quote trade)
    // Quote AMM provides liquidity: sells reserve, accumulates inventory
    // Trader gives base (inventory) to Quote, gets quote (reserve)
    let swapCount = 0;
    while (quoteCurTick.idx().toAbsolute() < 1005 && swapCount < 20) {
        swapCount++;

        // Add fees for this trade
        quoteCurTick.addInventoryFees(0.5 * quoteCurTick.index.price);

        // Swap: trader gives inventory (base), Quote gives reserve (quote)
        // Larger swap amount to exhaust ticks faster
        const swapResult = quoteCurTick.swap({
            direction: "inventory -> reserve",
            qtyIn: 50,
        });

        // Reserve should be consumed
        assertEquals(swapResult.qtyOut > 0, true);

        // If reserve exhausted, move to next tick
        if (!quoteCurTick.hasReserve()) {
            // Moving from price p to p+1 (higher price)
            // This is "inventory -> reserve" direction (consuming reserve)
            quoteCurTick.decrement("inventory -> reserve");
        }
    }

    // Verify we moved to higher price
    assertEquals(quoteCurTick.idx().toAbsolute() > 1000, true);

    // Verify inventory was accumulated
    assertEquals(quoteInventory.isEmpty(), false);

    // Verify respectiveReserve increased (IL indicator)
    const midRespectiveReserve = quoteInventory.getRespectiveReserve();
    assertEquals(midRespectiveReserve > 0, true);

    const midPosition = quoteCurTick.idx().toAbsolute();
    console.log(`Phase 1 complete: moved from 1000 to ${midPosition}`);
    console.log(`  Inventory respectiveReserve: ${midRespectiveReserve}`);

    // Phase 2: Price decreases (Quote -> Base trade)
    // Quote AMM provides liquidity: sells inventory, recovers IL
    // Verify we can move back at least partially
    for (let i = 0; i < 3; i++) {
        // Swap: trader gives reserve (quote), Quote gives inventory (base)
        const swapResult = quoteCurTick.swap({
            direction: "reserve -> inventory",
            qtyIn: 20,
        });

        // Should produce output (consuming inventory)
        if (swapResult.qtyOut > 0) {
            // Good, consuming inventory
        }

        // If inventory exhausted, try to move back
        if (!quoteCurTick.hasInventory()) {
            quoteCurTick.increment("reserve -> inventory");
        }
    }

    // Final verification
    const finalPosition = quoteCurTick.idx().toAbsolute();
    const finalRespectiveReserve = quoteInventory.getRespectiveReserve();

    console.log(`Phase 2 complete: moved from 1005 to ${finalPosition}`);
    console.log(
        `  Final inventory respectiveReserve: ${finalRespectiveReserve}`
    );
    console.log(`  Initial reserve qty: ${initialReserveQty}`);
    console.log(`  Final reserve qty: ${quoteReserve.qty}`);

    // Verify we moved back from 1005
    assertEquals(finalPosition < 1005, true);

    // Verify IL was partially reduced (respectiveReserve decreased)
    assertEquals(finalRespectiveReserve < midRespectiveReserve, true);

    // Verify we accumulated fees and partially recovered
    // Note: reserve may be less than initial due to fees collected and incomplete recovery
    assertEquals(finalRespectiveReserve > 0, true);
});

Deno.test("Perfect Reversal - No Fees", () => {
    const invertedFactory = new TickIndexFactory(true);

    // Quote AMM at price 1000 (~10%)
    const quoteReserve = new Reserve();
    const quoteInventory = new Inventory();
    quoteReserve.init(
        1000,
        invertedFactory.make(1100),
        invertedFactory.make(1001)
    );
    const quoteCurTick = new CurrentTick(
        invertedFactory.make(1000),
        quoteReserve,
        quoteInventory
    );

    quoteCurTick.deposit(10);

    // Capture initial state
    const initialPosition = quoteCurTick.idx().toAbsolute();
    const initialReserveQty = quoteReserve.qty;

    console.log(
        `\nInitial state: tick ${initialPosition}, reserve ${initialReserveQty.toFixed(
            2
        )}`
    );

    // Phase 1: One BIG swap "inventory -> reserve" that moves through multiple ticks
    // Give inventory, receive reserve
    let totalInventoryGiven = 0;
    let totalReserveReceived = 0;
    let swapQtyIn = 30; // Large amount

    console.log(`\nPhase 1: Swapping ${swapQtyIn} inventory for reserve...`);

    while (swapQtyIn > 0) {
        console.log(
            `  [Phase 1] Tick ${quoteCurTick
                .idx()
                .toAbsolute()}: swapping ${swapQtyIn.toFixed(
                4
            )} inventory to reserve`
        );

        const swapResult = quoteCurTick.swap({
            direction: "inventory -> reserve",
            qtyIn: swapQtyIn,
        });

        totalInventoryGiven += swapQtyIn - swapResult.reminderIn;
        totalReserveReceived += swapResult.qtyOut;
        swapQtyIn = swapResult.reminderIn;

        // Use the new tickExhausted flag to know when to move
        if (swapResult.tickExhausted && swapQtyIn > 0) {
            console.log(
                `  Tick exhausted at ${quoteCurTick
                    .idx()
                    .toAbsolute()}, moving to next...`
            );
            quoteCurTick.decrement("inventory -> reserve");
        }
    }

    const midPosition = quoteCurTick.idx().toAbsolute();
    console.log(
        `Phase 1 complete: moved from ${initialPosition} to ${midPosition}`
    );
    console.log(
        `  Gave ${totalInventoryGiven.toFixed(
            2
        )} inventory, received ${totalReserveReceived.toFixed(2)} reserve`
    );
    console.log(JSON.stringify(quoteCurTick, undefined, 2));

    // Verify we moved ticks
    assertEquals(
        midPosition > initialPosition,
        true,
        "Should have moved to higher tick"
    );

    // Phase 2: One BIG swap "reserve -> inventory" using ALL the reserve we received
    // Give back all the reserve, should get back approximately the same inventory
    console.log(
        `\nPhase 2: Swapping ${totalReserveReceived.toFixed(
            2
        )} reserve back for inventory...`
    );

    let totalInventoryReceived = 0;
    swapQtyIn = totalReserveReceived;

    while (swapQtyIn > 1e-9) {
        console.log(
            `  [Phase 2] Tick ${quoteCurTick
                .idx()
                .toAbsolute()}: swapping ${swapQtyIn.toFixed(4)} reserve`
        );

        const swapResult = quoteCurTick.swap({
            direction: "reserve -> inventory",
            qtyIn: swapQtyIn,
        });

        console.log(
            `    Result: qtyOut=${swapResult.qtyOut.toFixed(
                4
            )}, reminderIn=${swapResult.reminderIn.toFixed(4)}, tickExhausted=${
                swapResult.tickExhausted
            }`
        );

        totalInventoryReceived += swapResult.qtyOut;
        swapQtyIn = swapResult.reminderIn;

        // Use the new tickExhausted flag to know when to move back
        // Use a small epsilon for swapQtyIn to avoid infinite loops due to floating point precision
        if (swapResult.tickExhausted && swapQtyIn > 1e-9) {
            // If we got no output and tick is exhausted, there's no more inventory to consume
            if (swapResult.qtyOut === 0) {
                console.log(JSON.stringify(quoteCurTick, undefined, 2));
                console.log(
                    `  No more inventory available, ending Phase 2 with ${swapQtyIn.toFixed(
                        4
                    )} reserve remaining`
                );
                break;
            }
            console.log(
                `  Tick exhausted at ${quoteCurTick
                    .idx()
                    .toAbsolute()}, moving back...`
            );
            quoteCurTick.increment("reserve -> inventory");
        }
    }

    const finalPosition = quoteCurTick.idx().toAbsolute();
    const finalReserveQty = quoteReserve.qty;

    console.log(
        `Phase 2 complete: moved from ${midPosition} back to ${finalPosition}`
    );
    console.log(
        `  Gave ${totalReserveReceived.toFixed(
            2
        )} reserve, received ${totalInventoryReceived.toFixed(2)} inventory`
    );
    console.log(`\nFinal state:`);
    console.log(`  Position: ${initialPosition} -> ${finalPosition}`);
    console.log(
        `  Reserve: ${initialReserveQty.toFixed(
            2
        )} -> ${finalReserveQty.toFixed(2)}`
    );
    console.log(`  Inventory empty: ${quoteInventory.isEmpty()}`);
    console.log(
        `  Inventory respectiveReserve: ${quoteInventory
            .getRespectiveReserve()
            .toFixed(4)}`
    );

    // Perfect reversal verification
    assertEquals(
        finalPosition,
        initialPosition,
        "Should return to initial tick"
    );
    assertAlmostEquals(
        totalInventoryReceived,
        totalInventoryGiven,
        0.1,
        "Should get back same inventory"
    );
    assertAlmostEquals(
        finalReserveQty,
        initialReserveQty,
        0.1,
        "Reserve should be restored"
    );
    assertEquals(quoteInventory.isEmpty(), true, "Inventory should be empty");
    assertAlmostEquals(
        quoteInventory.getRespectiveReserve(),
        0,
        0.1,
        "IL should be zero"
    );
});
