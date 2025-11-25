import { assertEquals, assertThrows, assertAlmostEquals } from "jsr:@std/assert";
import { ReserveRange, InventoryRange } from "../range.ts";
import { TickIndexFactory } from "../ticks.ts";
import { BASE_PRICE } from "../utils.ts";

Deno.test("ReserveRange - Normal", () => {
    const factory = new TickIndexFactory(false);
    const left = factory.make(100);
    const right = factory.make(110);
    const range = new ReserveRange(1100, left, right);

    // Width is 11 (100 to 110 inclusive)
    assertEquals(range.width, 11);

    // takeBest() takes from Right (closest to price if price > right)
    // Reserve is "Left of Price".
    // If Price is 111, Best is 110.
    const best = range.takeBest();
    assertEquals(best.tickIdx.toAbsolute(), 110);
    assertEquals(best.qty, 100); // 1100 / 11 = 100

    // takeWorst() takes from Left (furthest from price)
    const worst = range.takeWorst();
    assertEquals(worst.tickIdx.toAbsolute(), 100);
    assertEquals(worst.qty, 100); // Remaining 1000 / 10 = 100

    // Verify bounds shifted
    // Right dec() -> 109
    // Left inc() -> 101
    // Remaining range: [101, 109]
    assertEquals(range.width, 9);
});

Deno.test("ReserveRange - Inverted", () => {
    const factory = new TickIndexFactory(true);
    // Inverted ticks:
    // Price is "Right" (Higher Relative).
    // Reserve is "Left" (Lower Relative).
    
    const left = factory.make(110); // Relative -110
    const right = factory.make(100); // Relative -100
    
    const range = new ReserveRange(1100, left, right);
    assertEquals(range.width, 11);

    // takeBest() -> Right (-100, Abs 100)
    const best = range.takeBest();
    assertEquals(best.tickIdx.toAbsolute(), 100);
    
    // takeWorst() -> Left (-110, Abs 110)
    const worst = range.takeWorst();
    assertEquals(worst.tickIdx.toAbsolute(), 110);
});

Deno.test("InventoryRange - Normal", () => {
    const factory = new TickIndexFactory(false);
    // Inventory is "Right of Price".
    // Left (lowest index) is closest to price.
    const left = factory.make(100);
    const right = factory.make(110); // Width 11
    const totalQty = 1000;
    const range = new InventoryRange(totalQty, left, right);

    // Geometric progression logic:
    // bestTickQty = (qty * (BASE_PRICE - 1)) / (BASE_PRICE^width - 1)
    const width = 11;
    const expectedBestQty = (totalQty * (BASE_PRICE - 1)) / (Math.pow(BASE_PRICE, width) - 1);

    // takeBest() -> Left (100)
    const best = range.takeBest();
    assertEquals(best.tickIdx.toAbsolute(), 100);
    assertAlmostEquals(best.qty, expectedBestQty, 1e-6);

    // After taking best, width is 10, qty reduced.
    // takeWorst() -> Right (110)
    // worstTickQty = bestTickQty * BASE_PRICE^(width - 1)
    // But we need to calculate based on the *current* state (width 10) or the formula for the *original* state?
    // range.takeWorst() uses the *current* qty and width.
    
    // Let's calculate expected worst from the *current* state.
    const currentQty = totalQty - best.qty;
    const currentWidth = 10;
    const expectedNewBest = (currentQty * (BASE_PRICE - 1)) / (Math.pow(BASE_PRICE, currentWidth) - 1);
    const expectedWorst = expectedNewBest * Math.pow(BASE_PRICE, currentWidth - 1);

    const worst = range.takeWorst();
    assertEquals(worst.tickIdx.toAbsolute(), 110);
    assertAlmostEquals(worst.qty, expectedWorst, 1e-6);
});

Deno.test("InventoryRange - Inverted", () => {
    const factory = new TickIndexFactory(true);
    // Inventory is "Right of Price" (Higher Relative).
    // Price at -120. Inventory at [-110, -100].
    // Left: -110 (Abs 110). Right: -100 (Abs 100).
    
    const left = factory.make(110); // Relative -110
    const right = factory.make(100); // Relative -100
    const totalQty = 1000;
    const range = new InventoryRange(totalQty, left, right);

    // Geometric progression check
    const width = 11;
    const expectedBestQty = (totalQty * (BASE_PRICE - 1)) / (Math.pow(BASE_PRICE, width) - 1);

    // takeBest() -> Left (-110, Abs 110)
    const best = range.takeBest();
    assertEquals(best.tickIdx.toAbsolute(), 110);
    assertAlmostEquals(best.qty, expectedBestQty, 1e-6);

    // takeWorst() -> Right (-100, Abs 100)
    const worst = range.takeWorst();
    assertEquals(worst.tickIdx.toAbsolute(), 100);
    
    // Check worst qty (based on remaining)
    const currentQty = totalQty - best.qty;
    const currentWidth = 10;
    const expectedNewBest = (currentQty * (BASE_PRICE - 1)) / (Math.pow(BASE_PRICE, currentWidth) - 1);
    const expectedWorst = expectedNewBest * Math.pow(BASE_PRICE, currentWidth - 1);
    
    assertAlmostEquals(worst.qty, expectedWorst, 1e-6);
});

Deno.test("Range - Empty State (Brick Policy)", () => {
    const factory = new TickIndexFactory(false);
    const left = factory.make(100);
    const right = factory.make(100); // Width 1
    const range = new ReserveRange(100, left, right);

    // Consume the only tick
    range.takeBest();
    assertEquals(range.isEmpty(), true);

    // Any further action should panic
    assertThrows(() => range.takeBest(), Error, "empty");
    assertThrows(() => range.takeWorst(), Error, "empty");
    assertThrows(() => range.put(10), Error, "empty");
    assertThrows(() => range.withdrawCut(0.5), Error, "empty");
});

Deno.test("Range - Symmetry", () => {
    // Verify that Base and Quote ranges behave consistently with respect to global price.
    //
    // Scenario: Global Price is 1000.
    //
    // Base Reserve (Normal):
    // - "Left of Price" (Relative Index < Price Index).
    // - Range: [900, 990].
    // - Best Tick (Closest to Price): 990.
    //
    // Quote Reserve (Inverted):
    // - "Left of Price" (Relative Index < Price Index).
    // - Quote Price Index = -Base Price Index = -1000.
    // - Range Relative: [-1100, -1010]. (Absolute: [1010, 1100]).
    // - Best Tick (Closest to Price -1000): -1010 (Absolute 1010).
    //
    // Result:
    // - Base Reserve takes from 990 (Just below Price).
    // - Quote Reserve takes from 1010 (Just above Price).
    //
    // This confirms they are symmetric around the price:
    // Base AMM holds Base (Reserve) below price.
    // Quote AMM holds Quote (Reserve) above price.
    
    const normalFactory = new TickIndexFactory(false);
    const invertedFactory = new TickIndexFactory(true);
    
    const baseRange = new ReserveRange(1000, normalFactory.make(900), normalFactory.make(990));
    const quoteRange = new ReserveRange(1000, invertedFactory.make(1100), invertedFactory.make(1010));
    
    assertEquals(baseRange.takeBest().tickIdx.toAbsolute(), 990);
    assertEquals(quoteRange.takeBest().tickIdx.toAbsolute(), 1010);
});
