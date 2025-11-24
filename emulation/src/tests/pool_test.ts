import { assertEquals, assertAlmostEquals } from "jsr:@std/assert";
import { Pool } from "../pool.ts";

Deno.test("Pool - Initialization", () => {
    // Initialize at price tick 1000
    const pool = new Pool(1000);
    
    // Access private AMMs to verify orientation
    const stableBase = (pool as any).stableAMM.base;
    const stableQuote = (pool as any).stableAMM.quote;
    
    // Base should be Normal (Relative = Absolute)
    // Initial tick 1000
    assertEquals(stableBase.curTick().index().toAbsolute(), 1000);
    
    // Quote should be Inverted (Relative = -Absolute)
    // Initial tick 1000
    assertEquals(stableQuote.curTick().index().toAbsolute(), 1000);
});

Deno.test("Pool - Deposit", () => {
    const pool = new Pool(1000);
    
    // Deposit 100 Base
    pool.deposit("base", 100);
    
    const stableBase = (pool as any).stableAMM.base;
    const driftingBase = (pool as any).driftingAMM.base;
    
    // STABLE_AMM_CUT = 0.05
    assertEquals(stableBase.getDepositedReserve(), 5);
    assertEquals(driftingBase.getDepositedReserve(), 95);
});

Deno.test("Pool - Swap Base -> Quote (Price Down)", () => {
    const pool = new Pool(1000);
    
    // Deposit liquidity (Large amount to avoid exhausting reserve ticks due to wide range)
    pool.deposit("base", 1000000);
    pool.deposit("quote", 1000000);
    
    // Swap Base -> Quote (User sells Base, buys Quote)
    // Price should go DOWN (Base becomes cheaper in terms of Quote? Or Quote becomes more expensive?)
    // Wait. Price P = Quote/Base?
    // If User sells Base, Supply of Base Up. Price of Base Down.
    // So P should go DOWN.
    
    // Initial ticks
    const initialBaseTick = (pool as any).stableAMM.base.curTick().index().toAbsolute();
    const initialQuoteTick = (pool as any).stableAMM.quote.curTick().index().toAbsolute();
    
    assertEquals(initialBaseTick, 1000);
    
    // Swap
    pool.swap({
        direction: "base -> quote",
        qtyIn: 10
    });
    
    const finalBaseTick = (pool as any).stableAMM.base.curTick().index().toAbsolute();
    
    // Price Down -> Tick Decreases (for Normal Base)
    // 1000 -> 999?
    // Or did we not move yet? 10 qty might not be enough to move a tick if reserve is deep.
    // But we just initialized, so reserve is fresh.
    // Stable AMM has 5% of 1000 = 50.
    // Drifting AMM has 95% of 1000 = 950.
    // 10 qtyIn might be consumed by current tick without moving.
    
    // Let's swap enough to move.
    // Reserve width?
    // Stable AMM: MIN_TICK to Current. Huge width.
    // Drifting AMM: Left Bound?
    // deposit() logic:
    // "For base drifting AMM, left bound is opposite (quote) worst inventory tick... If no inventory, default to min()"
    // So Drifting AMM also has huge width initially?
    // If width is huge, liquidity per tick is small.
    // 950 / (MAX_WIDTH) ~= 0.
    // So 10 qty should definitely exhaust the current tick!
    
    // Wait. If width is huge, liquidity is spread thin.
    // So current tick has very little liquidity.
    // So we should move MANY ticks.
    
    console.log(`Base -> Quote: Moved from ${initialBaseTick} to ${finalBaseTick}`);
    assertEquals(finalBaseTick < initialBaseTick, true, "Price should decrease (move left)");
});

Deno.test("Pool - Swap Quote -> Base (Price Up)", () => {
    const pool = new Pool(1000);
    
    pool.deposit("base", 1000000);
    pool.deposit("quote", 1000000);
    
    const initialBaseTick = (pool as any).stableAMM.base.curTick().index().toAbsolute();
    
    // Swap Quote -> Base (User sells Quote, buys Base)
    // Price of Base Up. P Up.
    
    pool.swap({
        direction: "quote -> base",
        qtyIn: 10
    });
    
    const finalBaseTick = (pool as any).stableAMM.base.curTick().index().toAbsolute();
    
    console.log(`Quote -> Base: Moved from ${initialBaseTick} to ${finalBaseTick}`);
    assertEquals(finalBaseTick > initialBaseTick, true, "Price should increase (move right)");
});

Deno.test("Pool - Full Simulation (Round Trip)", () => {
    const startTick = 1000;
    const pool = new Pool(startTick);
    
    // Deposit substantial liquidity
    // Note: Drifting AMM logic depends on "opposite worst inventory tick".
    // Initially no inventory, so it defaults to min().
    // So initially both Stable and Drifting are wide.
    pool.deposit("base", 1000000);
    pool.deposit("quote", 1000000);
    
    console.log("\nStarting Pool Simulation");
    
    // Phase 1: Base -> Quote (Sell Base, Buy Quote) -> Price Down
    // We want to push price down by some amount.
    let totalBaseSold = 0;
    let totalQuoteBought = 0;
    
    // Swap until we move at least 10 ticks down
    const targetTick = startTick - 10;
    let swaps = 0;
    
    while ((pool as any).stableAMM.base.curTick().index().toAbsolute() > targetTick && swaps < 100) {
        swaps++;
        const qtyIn = 100;
        const result = pool.swap({
            direction: "base -> quote",
            qtyIn: qtyIn
        });
        
        totalBaseSold += qtyIn; // Note: this includes fees!
        totalQuoteBought += result.qtyOut;
    }
    
    const midTick = (pool as any).stableAMM.base.curTick().index().toAbsolute();
    console.log(`Phase 1 Complete: Moved to ${midTick}`);
    console.log(`  Sold Base (Input): ${totalBaseSold}`);
    console.log(`  Bought Quote (Output): ${totalQuoteBought}`);
    
    assertEquals(midTick < startTick, true, "Should have moved price down");
    
    // Phase 2: Quote -> Base (Sell Quote, Buy Base) -> Price Up
    // We want to return to start.
    // We sell back the Quote we bought.
    // Note: We bought `totalQuoteBought`.
    // But we paid fees on input in Phase 1.
    // And we will pay fees on input in Phase 2.
    // So we won't get back the same amount of Base.
    // But we should be able to push the price back up.
    
    let remainingQuoteToSell = totalQuoteBought;
    swaps = 0;
    
    while (remainingQuoteToSell > 1e-9 && swaps < 100) {
        swaps++;
        const qtyIn = Math.min(remainingQuoteToSell, 100);
        
        const result = pool.swap({
            direction: "quote -> base",
            qtyIn: qtyIn
        });
        
        remainingQuoteToSell -= qtyIn;
        
        // Check if we reached start
        if ((pool as any).stableAMM.base.curTick().index().toAbsolute() >= startTick) {
            console.log("Returned to start tick!");
            break;
        }
    }
    
    const finalTick = (pool as any).stableAMM.base.curTick().index().toAbsolute();
    console.log(`Phase 2 Complete: Moved to ${finalTick}`);
    
    // We might not reach exactly startTick because of fees eating into our buying power.
    // But we should be close or have moved significantly up.
    assertEquals(finalTick > midTick, true, "Should have moved price up");
    
    // Check IL / Fees
    const avgIl = pool.getAvgIl();
    const fees = pool.getFees();
    console.log(`Average IL: ${avgIl}`);
    console.log(`Current Fees: ${fees}`);
    
    // IL should be non-zero (or close to it if we returned exactly, but fees prevent exact return)
    // Actually, if we return to start price, IL should be near zero?
    // "IL is the difference between value of assets held in AMM and value if held in wallet."
    // If price returns to start, IL -> 0.
    // But we lost some value to fees (which are in RecoveryBin).
    // RecoveryBin collateral counts towards Inventory value?
    // `withdraw` includes `recoveryBin.withdrawCut`.
    // So fees are part of the AMM value.
    // So IL should be low.
});
