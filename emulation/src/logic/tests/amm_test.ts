import { assertEquals, assertAlmostEquals } from "@std/assert";
import { AMM } from "../amm.ts";
import { TickIndexFactory } from "../ticks.ts";

Deno.test("AMM - Initialization", () => {
    const factory = new TickIndexFactory(false);
    const amm = new AMM(factory.make(100));

    assertEquals(amm.getDepositedReserve(), 0);
    assertEquals(amm.curTick.index.toAbsolute(), 100);
});

Deno.test("AMM - Deposit", () => {
    const factory = new TickIndexFactory(false);
    const amm = new AMM(factory.make(100));

    amm.deposit({ reserve: 100 });

    assertEquals(amm.getDepositedReserve(), 100);
    // Initial deposit for Stable AMM puts everything in Reserve (left of curTick), so curTick has no reserve.
    assertEquals(amm.curTick.hasReserve(), false);
});

Deno.test("AMM - Withdraw", () => {
    const factory = new TickIndexFactory(false);
    const amm = new AMM(factory.make(100));

    amm.deposit({ reserve: 100 });

    const result = amm.withdraw({ depositedReserve: 50 });

    assertEquals(result.reserve, 50);
    assertEquals(amm.getDepositedReserve(), 50);
});

Deno.test("AMM - Rebase", () => {
    const factory = new TickIndexFactory(false);
    const amm = new AMM(factory.make(100));

    // Initialize reserve
    amm.deposit({ reserve: 100 });

    // Access private reserve for testing
    const reserve = (amm as any).reserve;
    const initialLeft = reserve.getLeft().toAbsolute();

    // Target a new left bound (e.g., 90 -> 80)
    // Current left is likely MIN_TICK or close to it depending on init logic.
    // Let's check what init does.
    // If not provided, leftBound is min().
    // Let's provide a specific left bound for easier testing.

    const amm2 = new AMM(factory.make(100));
    amm2.deposit({
        reserve: 100,
        leftBound: factory.make(90),
    });

    const reserve2 = (amm2 as any).reserve;
    assertEquals(reserve2.getLeft().toAbsolute(), 90);

    // Rebase to 95 (move right, concentrating)
    // Logic says: newLeft = currentLeft + (targetLeft - currentLeft) / 2
    // target 95, current 90. distance 5. moveBy 2.
    // target > current. newLeft = 90 + 2 = 92.
    amm2.rebase(factory.make(95));

    assertEquals(reserve2.getLeft().toAbsolute(), 92);
});

Deno.test("AMM - Full Simulation (Buy then Sell)", () => {
    const factory = new TickIndexFactory(false);
    // Start at price tick 1000
    const startTickIdx = 1000;
    const amm = new AMM(factory.make(startTickIdx));

    // 1. Initialize AMM with reserve
    // Use a bounded range to make it realistic/easier to reason about
    amm.deposit({
        reserve: 1000,
        leftBound: factory.make(startTickIdx - 100),
    });

    console.log(`\nStarting Simulation: Tick ${startTickIdx}, Reserve 1000`);

    // 2. Execute multiple swaps "inventory -> reserve" (Buying reserve / Selling inventory)
    // This consumes reserve from the AMM and pushes the price UP (if we are buying reserve).

    let totalInventorySoldToAMM = 0;
    let totalReserveBoughtFromAMM = 0;
    let swaps = 0;

    // We want to span multiple ticks.
    // For Base AMM (Normal), Reserve is to the Left (Lower Price).
    // Buying Reserve (Inventory -> Reserve) consumes Reserve.
    // So we move Left (Decrement).
    const targetTickIdx = startTickIdx - 5;

    console.log("Phase 1: Buying Reserve (Pushing Price Down)");

    while (amm.curTick.index.toAbsolute() > targetTickIdx && swaps < 100) {
        swaps++;

        // Swap
        const qtyIn = 10; // User gives 10 inventory
        const result = amm.curTick.swap({
            direction: "inventory -> reserve",
            qtyIn: qtyIn,
        });

        totalInventorySoldToAMM += qtyIn - result.reminderIn;
        totalReserveBoughtFromAMM += result.qtyOut;

        if (!amm.curTick.hasReserve()) {
            // Force new inventory range to avoid merging and redistribution (which causes overshoot)
            (amm as any).inventory.notifyReserveChanged();
            // Reserve exhausted, move to next tick with reserve (Left)
            amm.curTick.decrement("inventory -> reserve");
        }
    }

    const midTickIdx = amm.curTick.index.toAbsolute();
    console.log(`Phase 1 Complete: Moved to Tick ${midTickIdx}`);
    console.log(`  Sold Inventory: ${totalInventorySoldToAMM}`);
    console.log(`  Bought Reserve: ${totalReserveBoughtFromAMM}`);

    assertEquals(
        midTickIdx < startTickIdx,
        true,
        "Should have moved price down"
    );

    // 3. Execute "reserve -> inventory" swaps (Selling reserve back / Buying inventory)
    console.log("Phase 2: Selling Reserve (Pushing Price Up)");

    let remainingReserveToSell = totalReserveBoughtFromAMM;
    swaps = 0;

    while (
        remainingReserveToSell > 1e-15 &&
        swaps < 100 &&
        amm.curTick.index.toAbsolute() <= startTickIdx
    ) {
        swaps++;

        // We sell reserve.
        const qtyIn = Math.min(remainingReserveToSell, 10); // Chunk it

        const result = amm.curTick.swap({
            direction: "reserve -> inventory",
            qtyIn: qtyIn,
        });

        remainingReserveToSell -= qtyIn - result.reminderIn;

        let moved = false;
        // If AMM runs out of inventory, move Right (Increment)
        if (!amm.curTick.hasInventory()) {
            amm.curTick.increment("reserve -> inventory");
            moved = true;
        }

        // If we made no progress, break to avoid infinite loop
        if (result.qtyOut === 0 && result.reminderIn === qtyIn && !moved) {
            break;
        }
    }

    const finalTickIdx = amm.curTick.index.toAbsolute();
    console.log(`Phase 2 Complete: Moved to Tick ${finalTickIdx}`);
    console.log(`  Remaining Reserve to Sell: ${remainingReserveToSell}`);

    // 4. Verify
    // Should be back at start tick
    // Verify we returned to start tick (or passed it slightly due to clearing the last tick)
    // If we cleared tick 1000, we increment to 1001.
    assertEquals(
        finalTickIdx >= startTickIdx,
        true,
        "Should have returned to start tick"
    );
    assertEquals(
        finalTickIdx <= startTickIdx + 1,
        true,
        "Should not have overshot significantly"
    );

    // Verify Inventory is empty (we bought it all back)
    const inventory = (amm as any).inventory;
    assertEquals(inventory.isEmpty(), true, "AMM Inventory should be empty");

    // Verify Reserve is restored (approx)
    // We deposited 1000. We bought ~40, sold ~40.
    // Actual reserve should be close to 1000.
    const actualReserve =
        (amm as any).reserve.qty + (amm.curTick as any).currentReserve;
    assertAlmostEquals(
        actualReserve,
        1000,
        0.001,
        "Reserve should be restored"
    );
});
