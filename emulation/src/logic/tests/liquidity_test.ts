import { assertEquals, assertThrows, assertAlmostEquals } from "@std/assert";
import { Reserve, Inventory } from "../liquidity.ts";
import { TickIndexFactory } from "../ticks.ts";
import { BASE_PRICE, MAX_TICK } from "../utils.ts";

Deno.test("Reserve Manager - Lifecycle (Normal)", () => {
    const factory = new TickIndexFactory(false);
    const reserve = new Reserve();

    // 1. Init
    const left = factory.make(100);
    const right = factory.make(110);
    reserve.init(1100, left, right);
    assertEquals(reserve.isInitted(), true);
    assertEquals(reserve.width, 11);

    // 2. Double Init Check
    assertThrows(
        () => reserve.init(100, left, right),
        Error,
        "already initted"
    );

    // 3. Take Best (Rightmost, closest to price)
    // Range [100, 110]. Best is 110.
    // We must pass the expected tick index (110).
    const tick110 = factory.make(110);
    const best = reserve.takeRight(tick110);
    assertEquals(best?.idx.toAbsolute(), 110);
    assertEquals(best?.reserve, 100); // 1100 / 11

    // 3b. Invariant Violation Check
    // If we ask for 109 but the best is 109 (after taking 110), it works.
    // But if we ask for 100 (far left), it should panic because best is 109.
    const tick100 = factory.make(100);
    assertThrows(
        () => reserve.takeRight(tick100),
        Error,
        "Reserve invariant violated"
    );

    // 4. Take Worst (Leftmost, furthest from price)
    // Range [100, 109]. Worst is 100.
    const worst = reserve.takeWorst();
    assertEquals(worst?.idx.toAbsolute(), 100);
    assertEquals(worst?.reserve, 100); // 1000 / 10

    // 5. Put (Add liquidity)
    // Range [101, 109]. Qty 900.
    reserve.putUniform(900);
    // Qty 1800. Width 9.

    // 6. Stretch to CurTick
    // Current range right is 109.
    // Stretch to 115.
    const curTick = factory.make(115);
    reserve.stretchToCurTick(curTick);
    // New range [101, 115]. Width 15.
    assertEquals(reserve.width, 15);

    // 7. Withdraw Cut
    // Qty 1800. Cut 0.5.
    const withdrawn = reserve.withdrawCut(0.5);
    assertEquals(withdrawn, 900);
    // Remaining 900.
});

Deno.test("Reserve Manager - Lifecycle (Inverted)", () => {
    const factory = new TickIndexFactory(true);
    const reserve = new Reserve();

    // Inverted: Price is "Right" (Higher Relative). Reserve is "Left" (Lower Relative).
    // Range [-110, -100]. Left: -110 (Abs 110). Right: -100 (Abs 100).
    const left = factory.make(110);
    const right = factory.make(100);

    reserve.init(1100, left, right);

    // Take Best (Rightmost, closest to price) -> -100 (Abs 100)
    const tick100 = factory.make(100);
    const best = reserve.takeRight(tick100);
    assertEquals(best?.idx.toAbsolute(), 100);

    // Take Worst (Leftmost, furthest from price) -> -110 (Abs 110)
    const worst = reserve.takeWorst();
    assertEquals(worst?.idx.toAbsolute(), 110);
});

Deno.test("Inventory Manager - Lifecycle & Flows", () => {
    const factory = new TickIndexFactory(false);
    const inventory = new Inventory();

    // 1. Put Best (Simulate Decrement / Moving Left)
    // Scenario: Price moves from 102 to 101. We put 101 into inventory.
    const tick101 = factory.make(101);
    inventory.putLeft({ idx: tick101, inventory: 100 });

    assertEquals(inventory.qty(), 100);
    assertEquals(inventory.isEmpty(), false);

    // Respective Reserve: 100 / Price(101)
    const expectedRes1 = 100 / Math.pow(BASE_PRICE, 101);
    assertAlmostEquals(inventory.getRespectiveReserve(), expectedRes1, 1e-6);

    // 2. Put Best again (Same range)
    // Scenario: Price moves from 101 to 100. We put 100 into inventory.
    // 100 < 101, so this is valid (extending range to the left/lower index).
    const tick100 = factory.make(100);
    inventory.putLeft({ idx: tick100, inventory: 100 });
    assertEquals(inventory.qty(), 200);

    // 2b. Invariant Violation Check (Put Best)
    // If we try to put 102 (higher than current best 100), it should panic.
    // Inventory must be filled in descending order (as price drops).
    const tick102 = factory.make(102);
    assertThrows(
        () => inventory.putLeft({ idx: tick102, inventory: 100 }),
        Error,
        "Inventory invariant violated"
    );

    // 3. Notify Reserve Changed (Simulate Gap)
    inventory.notifyReserveChanged();

    // 4. Put Best (New Range)
    // Scenario: Price dropped significantly, now at 90.
    // We put 90 into inventory. 90 < 100, so valid.
    const tick90 = factory.make(90);
    inventory.putLeft({ idx: tick90, inventory: 100 });
    assertEquals(inventory.qty(), 300);

    // 5. Take Best (Simulate Increment / Moving Right)
    // Scenario: Price rises. We consume inventory starting from the lowest index (closest to price).
    // Ranges: [90] and [100, 101].
    // Best is 90.
    const best90 = inventory.takeLeft(tick90);
    assertEquals(best90?.idx.toAbsolute(), 90);

    // Now [90] is empty. Next best is 100.
    const best100 = inventory.takeLeft(tick100);
    assertEquals(best100?.idx.toAbsolute(), 100);

    // 6. Put Worst New Range
    // Scenario: Recovery/Rebalancing adds a range at the far end (Highest Index).
    // Current Worst is 101. New Worst must be > 101.
    const tick105 = factory.make(105);
    inventory.putRightNewRange({ idx: tick105, inventory: 50 });

    // 6b. Invariant Violation Check (Put Worst)
    // If we try to put 104 (less than current worst 105), it should panic.
    const tick104 = factory.make(104);
    assertThrows(
        () => inventory.putRightNewRange({ idx: tick104, inventory: 50 }),
        Error,
        "Inventory invariant violated"
    );
});

Deno.test("Inventory Manager - Inverted", () => {
    const factory = new TickIndexFactory(true);
    const inventory = new Inventory();

    // Inverted: Price is Right. Inventory is Right (Higher Relative).
    // But "Best" is always Closest to Price (Lowest Relative Index in Inventory).
    // "Worst" is Furthest from Price (Highest Relative Index in Inventory).

    // 1. Put Best (Simulate Price Drop / Moving Left)
    // We put ticks in descending order of relative index.
    // Tick -100 (Abs 100).
    const tick100 = factory.make(100); // Rel -100
    inventory.putLeft({ idx: tick100, inventory: 100 });

    // 2. Put Best (Next Lower Relative)
    // Tick -101 (Abs 101). -101 < -100. Valid.
    const tick101 = factory.make(101); // Rel -101
    inventory.putLeft({ idx: tick101, inventory: 100 });

    // 3. Take Best (Closest to Price / Lowest Relative)
    // Best is -101 (Abs 101).
    const best = inventory.takeLeft(tick101);
    assertEquals(best?.idx.toAbsolute(), 101);
});

Deno.test("Symmetry - Base vs Quote", () => {
    const normalFactory = new TickIndexFactory(false);
    const invertedFactory = new TickIndexFactory(true);

    const baseReserve = new Reserve();
    const quoteReserve = new Reserve();

    // Global Price 1000.
    // Base Reserve: [900, 990].
    baseReserve.init(1000, normalFactory.make(900), normalFactory.make(990));

    // Quote Reserve: [1010, 1100].
    // Inverted: Left -1100, Right -1010.
    quoteReserve.init(
        1000,
        invertedFactory.make(1100),
        invertedFactory.make(1010)
    );

    // Base Best -> 990.
    const baseBestTick = normalFactory.make(990);
    assertEquals(baseReserve.takeRight(baseBestTick)?.idx.toAbsolute(), 990);

    // Quote Best -> 1010.
    const quoteBestTick = invertedFactory.make(1010);
    assertEquals(quoteReserve.takeRight(quoteBestTick)?.idx.toAbsolute(), 1010);
});

Deno.test("Peek Methods - Reserve & Inventory", () => {
    const factory = new TickIndexFactory(false);

    // Reserve Peek
    const reserve = new Reserve();
    const rLeft = factory.make(100);
    const rRight = factory.make(110);
    reserve.init(1100, rLeft, rRight);

    // Peek Best (110)
    const peekRBest = reserve.peekRight();
    assertEquals(peekRBest?.idx.toAbsolute(), 110);
    assertEquals(peekRBest?.reserve, 100);
    assertEquals(reserve.width, 11); // Should not change

    // Peek Worst (100)
    const peekRWorst = reserve.peekLeft();
    assertEquals(peekRWorst?.idx.toAbsolute(), 100);
    assertEquals(peekRWorst?.reserve, 100);
    assertEquals(reserve.width, 11); // Should not change

    // Inventory Peek
    const inventory = new Inventory();
    const tick100 = factory.make(100);
    inventory.putLeft({ idx: tick100, inventory: 100 });

    // Peek Best (100)
    const peekIBest = inventory.peekLeft();
    assertEquals(peekIBest?.idx.toAbsolute(), 100);
    assertEquals(peekIBest?.inventory, 100);
    assertEquals(inventory.qty(), 100); // Should not change

    // Peek Worst (100)
    const peekIWorst = inventory.peekRight();
    assertEquals(peekIWorst?.idx.toAbsolute(), 100);
    assertEquals(peekIWorst?.inventory, 100);
    assertEquals(inventory.qty(), 100); // Should not change

    // Add another tick to Inventory (90) - Simulate gap
    inventory.notifyReserveChanged();
    const tick90 = factory.make(90);
    inventory.putLeft({ idx: tick90, inventory: 100 });

    // Peek Best (90)
    const peekIBest2 = inventory.peekLeft();
    assertEquals(peekIBest2?.idx.toAbsolute(), 90);

    // Peek Worst (100) - Still 100 because it's in the older range
    const peekIWorst2 = inventory.peekRight();
    assertEquals(peekIWorst2?.idx.toAbsolute(), 100);
});

Deno.test("Symmetry - Realistic Flow (Base -> Quote -> Base)", () => {
    const normalFactory = new TickIndexFactory(false);
    const invertedFactory = new TickIndexFactory(true);

    // Setup: Price 1000.
    // Base AMM (Normal): Reserve [900, 999].
    const baseReserve = new Reserve();
    baseReserve.init(1000, normalFactory.make(900), normalFactory.make(999));

    // Quote AMM (Inverted): Reserve [1001, 1100].
    const quoteReserve = new Reserve();
    const quoteInventory = new Inventory();
    quoteReserve.init(
        1000,
        invertedFactory.make(1100),
        invertedFactory.make(1001)
    );

    // Capture initial state for verification
    const initialQuoteReserveQty = quoteReserve.qty;
    const initialQuoteReserveWidth = quoteReserve.width;

    // Phase 1: Base -> Quote Trade (Price 1000 -> 1005)
    // Quote AMM provides liquidity (Reserve -> Inventory).
    // Base AMM stretches Reserve.
    for (let p = 1001; p <= 1005; p++) {
        const tick = normalFactory.make(p);

        // Base AMM: Stretches reserve to match current tick.
        baseReserve.stretchToCurTick(tick);

        // Quote AMM: Consumes Reserve, Creates Inventory.
        const quoteTick = invertedFactory.make(p);

        // Quote takes from Reserve (at p).
        const qResTick = quoteReserve.takeRight(quoteTick);
        assertEquals(qResTick?.idx.toAbsolute(), p);

        // Quote puts to Inventory (at p-1).
        // The inventory tick is the one we just left.
        const prevTick = invertedFactory.make(p - 1);

        // Ensure we can spawn new range if empty (first iteration)
        if (quoteInventory.isEmpty()) quoteInventory.notifyReserveChanged();

        quoteInventory.putLeft({ idx: prevTick, inventory: qResTick!.reserve });
    }

    // Verify State after Phase 1
    // Base: Reserve stretched to 1005.
    assertEquals(baseReserve.peekRight()?.idx.toAbsolute(), 1005);

    // Quote: Reserve consumed up to 1005. Best is 1006.
    assertEquals(quoteReserve.peekRight()?.idx.toAbsolute(), 1006);

    // Quote: Inventory has [1000, 1004]. Best (Left) is 1004.
    assertEquals(quoteInventory.peekLeft()?.idx.toAbsolute(), 1004);
    assertEquals(quoteInventory.isEmpty(), false);

    // Quote: respectiveReserve should be > 0 (we've accumulated inventory)
    const midRespectiveReserve = quoteInventory.getRespectiveReserve();
    assertEquals(midRespectiveReserve > 0, true);

    // Phase 2: Quote -> Base Trade (Price 1005 -> 1000)
    // Both AMMs provide liquidity.
    // Base: Takes from Reserve.
    // Quote: Takes from Inventory and puts back to Reserve (FULL RECOVERY).
    for (let p = 1005; p >= 1001; p--) {
        const tick = normalFactory.make(p);

        // Base AMM: Takes from Reserve (at p).
        const bResTick = baseReserve.takeRight(tick);
        assertEquals(bResTick?.idx.toAbsolute(), p);

        // Quote AMM: Takes from Inventory and recovers to Reserve.
        const quoteTick = invertedFactory.make(p - 1);
        const qInvTick = quoteInventory.takeLeft(quoteTick);
        assertEquals(qInvTick?.idx.toAbsolute(), p - 1);

        // Quote recovers IL: Put back to Reserve.
        // Stretch Reserve to current tick first.
        quoteReserve.stretchToCurTick(quoteTick);
        quoteReserve.putUniform(qInvTick!.inventory);
    }

    // Verify Final State - Full Recovery

    // Base: Reserve consumed down to 1000. Best is 1000.
    assertEquals(baseReserve.peekRight()?.idx.toAbsolute(), 1000);

    // Quote: Inventory Empty (Full Recovery).
    assertEquals(quoteInventory.isEmpty(), true);
    assertEquals(quoteInventory.qty(), 0);

    // Quote: respectiveReserve should be 0 (or very close due to floating point).
    const finalRespectiveReserve = quoteInventory.getRespectiveReserve();
    assertAlmostEquals(finalRespectiveReserve, 0, 1e-5);

    // Quote: Reserve quantity should match initial (Full Recovery).
    const finalQuoteReserveQty = quoteReserve.qty;
    assertAlmostEquals(finalQuoteReserveQty, initialQuoteReserveQty, 1e-10);

    // Quote: Reserve width should be back to original + stretch.
    // Initial: [1001, 1100] = 100 width.
    // After Phase 2: [1000, 1100] = 101 width (stretched to 1000).
    assertEquals(quoteReserve.width, initialQuoteReserveWidth + 1);
    // Quote Reserve Best (Right, closest to price) is 1000.
    assertEquals(quoteReserve.peekRight()?.idx.toAbsolute(), 1000);
    // Quote Reserve Worst (Left, furthest from price) is 1100.
    assertEquals(quoteReserve.peekLeft()?.idx.toAbsolute(), 1100);
});

Deno.test("Boundary Conditions - MIN/MAX Tick", () => {
    const factory = new TickIndexFactory(false);

    // Verify that operations at MAX_TICK boundaries panic correctly.
    // This ensures that we don't silently wrap around or create invalid states.

    const maxTick = factory.make(MAX_TICK);
    const rMax = new Reserve();
    rMax.init(100, maxTick, maxTick); // Width 1

    // takeWorst attempts to increment the left bound (MAX_TICK).
    // This should panic because it exceeds MAX_TICK.
    assertThrows(() => rMax.takeWorst(), Error, "higher than max tick");
});
