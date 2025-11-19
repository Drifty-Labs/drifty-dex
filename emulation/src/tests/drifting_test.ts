import { assertEquals } from "@std/assert";
import { Pool } from "../pool.ts";
import { TickIndex } from "../ticks.ts";
import { Inventory, Reserve } from "../liquidity.ts";
import { InventoryRange, ReserveRange } from "../range.ts";
import { AMM } from "../amm.ts";

Deno.test("Inventory.peekWorst() returns correct tick without modifying state", () => {
    const idx = new TickIndex(false, 100);
    const inventory = new Inventory();
    
    // Add some inventory
    inventory.putWorstNewRange({ inventory: 100, idx: idx.clone() });
    
    const peeked = inventory.peekWorst();
    assertEquals(peeked?.inventory, 100);
    assertEquals(peeked?.idx.index(), 100);
    
    // Verify state is unchanged
    const peekedAgain = inventory.peekWorst();
    assertEquals(peekedAgain?.inventory, 100);
    assertEquals(peekedAgain?.idx.index(), 100);
    
    // Verify takeWorst removes it
    const taken = inventory.takeWorst();
    assertEquals(taken?.inventory, 100);
    assertEquals(inventory.peekWorst(), undefined);
});

Deno.test("Reserve.rebase() concentrates liquidity", () => {
    const left = new TickIndex(false, 0);
    const right = new TickIndex(false, 100);
    const reserve = new Reserve();
    
    reserve.init(1000, left.clone(), right.clone());
    assertEquals(reserve.width, 101);
    
    const newLeft = new TickIndex(false, 50);
    reserve.rebase(newLeft.clone());
    
    assertEquals(reserve.width, 51); // 100 - 50 + 1
    assertEquals(reserve.getLeft().index(), 50);
});

Deno.test("Negated Reserve (Asks) behaves correctly", () => {
    // For Asks (Base), we use Normal TickIndex with Negated values.
    // Price 100 -> Index -100.
    const tick = new TickIndex(false, -100); 
    
    // inc() adds 1: -100 -> -99.
    // -99 corresponds to Price 99.
    // So inc() moves Price DOWN.
    tick.inc();
    assertEquals(tick.index(), -99);
    
    // dec() subtracts 1: -99 -> -100.
    tick.dec();
    assertEquals(tick.index(), -100);
    
    // dec() subtracts 1: -100 -> -101.
    // -101 corresponds to Price 101.
    // So dec() moves Price UP.
    tick.dec();
    assertEquals(tick.index(), -101);
});

Deno.test("Pool.rebase() implements logarithmic drift", () => {
    const pool = new Pool(100); // Current tick 100
    
    // Deposit to initialize reserves (stable: min..100, drifting: min..100)
    // Deposit to initialize reserves (stable: min..100, drifting: min..100)
    pool.deposit("base", 2000000);
    pool.deposit("quote", 2000000);
    
    // Simulate a swap to generate inventory on quote side (base -> quote)
    // This puts inventory into quote AMM
    pool.swap({ qtyIn: 100, direction: "base -> quote" });
    
    // Now we have inventory in quote AMM.
    // Drifting base AMM should drift towards quote worst inventory.
    // Quote worst inventory should be around current tick (100).
    // Base reserve left bound is at MIN_TICK (very small).
    
    // Let's check initial state
    // We can't easily access internal AMMs of pool directly without casting to any or exposing them.
    // For testing purposes, we can use `any`.
    const p = pool as any;
    const baseDrifting = p.driftingAMM.base as AMM;
    
    const initialLeft = baseDrifting["reserve"].getLeft().index();
    // MIN_TICK is likely very small.
    
    // The target is the quote worst inventory tick.
    const quoteWorst = p.driftingAMM.quote.getWorstInventoryTick();
    // Should be close to 100.
    
    pool.rebase();
    
    const newLeft = baseDrifting["reserve"].getLeft().index();
    
    // Distance was roughly 100 - MIN_TICK.
    // New left should be MIN_TICK + (100 - MIN_TICK) / 2.
    
    // Let's verify it moved significantly
    if (newLeft <= initialLeft) {
        throw new Error(`Expected drift: newLeft ${newLeft} > initialLeft ${initialLeft}`);
    }
});

Deno.test("Pool.deposit() respects drifting bounds", () => {
    const pool = new Pool(100);
    pool.deposit("base", 2000);
    
    const p = pool as any;
    const baseDrifting = p.driftingAMM.base as AMM;
    
    // Rebase to move the left bound
    // Force a target for testing
    const target = new TickIndex(false, -50); // Base is Negated
    baseDrifting.rebase(target);
    
    const leftAfterRebase = baseDrifting["reserve"].getLeft().index();
    // Should be MIN + (50 - MIN) / 2
    
    // Now deposit again
    pool.deposit("base", 1000);
    
    // The new deposit should respect the drifted left bound?
    // Wait, `deposit` calculates `leftBound` based on opposite inventory.
    // If opposite inventory is empty (which it is here), it defaults to `undefined` -> `min()`.
    // So `deposit` will RE-INIT the reserve if it wasn't initted?
    // No, `deposit` checks `if (!this.reserve.isInitted())`.
    // Since it IS initted, it just adds liquidity.
    // Does it respect the current range?
    // `Reserve.put` adds to the existing range.
    // `Reserve.init` is only called if NOT initted.
    
    // So `deposit` logic:
    // if initted: add to existing range (respects current left/right).
    // if not initted: init with `leftBound` (from opposite inventory).
    
    // So if we rebase, the range changes. Subsequent deposits add to that changed range.
    // This confirms the behavior.
    
    const leftAfterDeposit = baseDrifting["reserve"].getLeft().index();
    assertEquals(leftAfterDeposit, leftAfterRebase);
});
