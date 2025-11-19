
import { assertEquals, assertThrows } from "jsr:@std/assert";
import { TickIndex } from "../ticks.ts";
import { ReserveRange, InventoryRange } from "../range.ts";

Deno.test("ReserveRange: Normal Orientation", () => {
    // Normal: Left < Right. takeBest (Right) consumes closest to price.
    const left = new TickIndex(false, 90);
    const right = new TickIndex(false, 100);
    const range = new ReserveRange(110, left, right); // 11 ticks (90..100 inclusive) -> 10 per tick

    assertEquals(range.width, 11);

    // takeBest should take from Right (100)
    const best = range.takeBest();
    assertEquals(best.qty, 10);
    assertEquals(best.tickIdx.index(), 100);
    assertEquals(range.width, 10);

    // takeWorst should take from Left (90)
    const worst = range.takeWorst();
    assertEquals(worst.qty, 10);
    assertEquals(worst.tickIdx.index(), 90);
    assertEquals(range.width, 9);
});

Deno.test("ReserveRange: Inverted Orientation", () => {
    // Inverted: Left > Right (logically). But TickIndex arithmetic is simple.
    // If Inverted means "Reserve is High Price", then Left (Reserve) > Right (Price).
    // Let's see how TickIndex handles it.
    
    // If we use simple arithmetic:
    // Inverted Tick(110) > Inverted Tick(100) ?
    // TickIndex.gt implementation: return this.isInverted ? this.idx < to.idx : this.idx > to.idx;
    
    // So for Inverted: 110 < 100 is TRUE (110 is "greater" price-wise if inverted? No wait)
    // Inverted usually means Quote side.
    // Quote Reserve is at LOW price (Bids).
    // So Reserve is Left of Price.
    // If Price is 100. Reserve is 90.
    // Inverted(90) vs Inverted(100).
    // 90 < 100.
    
    // Wait, Base is Asset. Reserve is Asks (High Price).
    // So Base Reserve should be > Price.
    // If Price is 100. Reserve is 110.
    // Normal(110) > Normal(100). Correct.
    
    // Quote is Numeraire. Reserve is Bids (Low Price).
    // So Quote Reserve should be < Price.
    // If Price is 100. Reserve is 90.
    // Inverted(90) < Inverted(100).
    
    // So "Left" of ReserveRange always means "Further from Price"?
    // Or does it mean "Lower Index"?
    
    // Let's test what ReserveRange expects.
    // ReserveRange expects Left < Right (in terms of .lt()).
    
    const left = new TickIndex(true, 110);
    const right = new TickIndex(true, 100);
    
    // Inverted: 110 < 100 ? (110 > 100 is false, so 110 < 100 is true?)
    // TickIndex.lt: return this.isInverted ? this.idx > to.idx : this.idx < to.idx;
    // 110 > 100 is TRUE. So 110 is "less than" 100 in Inverted world.
    
    // So [110, 100] should be valid for Inverted ReserveRange.
    
    const range = new ReserveRange(110, left, right);
    
    // Width: right.distance(left) + 1
    // distance: abs(100 - 110) = 10. + 1 = 11.
    assertEquals(range.width, 11);
    
    // takeBest: takes from Right (100).
    // For Inverted, Right (100) is "closer" to Price (e.g. 99) than Left (110).
    // So this matches "Reserve is Bids" (Low Price) logic?
    // Wait, if Inverted is Quote (Bids), then Reserve is < Price.
    // If Price is 100. Reserve is 90..99.
    // Left=90, Right=99.
    // Inverted(90) lt Inverted(99)?
    // 90 > 99 is FALSE. So 90 is NOT lt 99.
    // So [90, 99] is INVALID for Inverted?
    
    // Let's verify this hypothesis with the test.
});

Deno.test("ReserveRange: Inverted Orientation (Quote/Bids style)", () => {
    // Quote Reserve: 90..99 (Price 100)
    // We want Left=90, Right=99.
    const left = new TickIndex(true, 90);
    const right = new TickIndex(true, 99);
    
    // Inverted: 90 lt 99? -> 90 > 99? FALSE.
    // So Left is NOT less than Right.
    // ReserveRange throws if left > right.
    // So [90, 99] should throw.
    
    assertThrows(() => {
        new ReserveRange(100, left, right);
    });
    
    // So for Inverted, we must swap them? [99, 90]?
    // Inverted(99) lt Inverted(90)? -> 99 > 90? TRUE.
    // So Left=99, Right=90 is valid.
    
    const validLeft = new TickIndex(true, 99);
    const validRight = new TickIndex(true, 90);
    const range = new ReserveRange(100, validLeft, validRight);
    
    assertEquals(range.width, 10); // 90..99 is 10 ticks
    
    // takeBest takes from Right (90).
    // But 90 is Further from Price (100) than 99!
    // Reserve should take from Closest to Price.
    // So it should take from 99.
    // But ReserveRange.takeBest() takes from Right.
    // Here Right is 90.
    
    // THIS IS THE PROBLEM.
    // For Inverted (Quote/Bids), "Right" (end of range) is 90 (Low). "Left" (start) is 99 (High).
    // We want to take from 99 (High, closest to Price 100).
    // But takeBest takes from Right (90).
    
    const best = range.takeBest();
    assertEquals(best.tickIdx.index(), 90); 
    // This confirms the issue: It takes 90, which is WRONG for Bids (should take highest bid 99).
});

Deno.test("ReserveRange: Asks (Negated Index Strategy)", () => {
    // Asks: 101..110. Best is 101.
    // Negated: -101..-110.
    // We want Best (-101) to be Right.
    // We want Worst (-110) to be Left.
    // Range [-110, -101].
    // Left < Right? -110 < -101. TRUE (Normal comparison).
    
    const left = new TickIndex(false, -110);
    const right = new TickIndex(false, -101);
    
    const range = new ReserveRange(100, left, right);
    
    assertEquals(range.width, 10);
    
    // takeBest takes Right (-101).
    const best = range.takeBest();
    assertEquals(best.tickIdx.index(), -101);
    // -101 corresponds to Price 101. Best Ask. Correct!
    
    // takeWorst takes Left (-110).
    const worst = range.takeWorst();
    assertEquals(worst.tickIdx.index(), -110);
    // -110 corresponds to Price 110. Worst Ask. Correct!
});
