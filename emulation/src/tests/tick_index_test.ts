import { assertEquals } from "@std/assert";
import { TickIndex } from "../ticks.ts";

Deno.test("TickIndex: Non-inverted initialization", () => {
    const tick = new TickIndex(false, 100);
    assertEquals(tick.index(), 100);
    assertEquals(tick.toAbsolute(), 100);
});

Deno.test("TickIndex: Inverted initialization", () => {
    const tick = new TickIndex(true, 100);
    assertEquals(tick.index(), 100);
    assertEquals(tick.toAbsolute(), 100);
});

Deno.test("TickIndex: clone(true) creates synchronized mirror", () => {
    const base = new TickIndex(false, 100);
    const quote = base.clone(true);
    
    assertEquals(base.toAbsolute(), quote.toAbsolute(),
        "Base and Quote should have same absolute value after clone(true)");
    assertEquals(base.index(), quote.index(),
        "Base and Quote should have same raw index after clone(true)");
});

Deno.test("TickIndex: multiple inc() operations maintain sync", () => {
    const base = new TickIndex(false, 100);
    const quote = base.clone(true);
    
    // Apply 10 increments to both
    for (let i = 0; i < 10; i++) {
        base.inc();
        quote.inc();
    }
    
    assertEquals(base.index(), 110);
    assertEquals(quote.index(), 110);
    assertEquals(base.toAbsolute(), quote.toAbsolute(),
        "After 10 inc() operations, ticks should remain synchronized");
});

Deno.test("TickIndex: multiple dec() operations maintain sync", () => {
    const base = new TickIndex(false, 100);
    const quote = base.clone(true);
    
    // Apply 10 decrements to both
    for (let i = 0; i < 10; i++) {
        base.dec();
        quote.dec();
    }
    
    assertEquals(base.index(), 90);
    assertEquals(quote.index(), 90);
    assertEquals(base.toAbsolute(), quote.toAbsolute(),
        "After 10 dec() operations, ticks should remain synchronized");
});

Deno.test("TickIndex: mixed inc/dec operations maintain sync", () => {
    const base = new TickIndex(false, 100);
    const quote = base.clone(true);
    
    // Mix of operations
    base.inc(); quote.inc();     // 101
    base.inc(); quote.inc();     // 102
    base.dec(); quote.dec();     // 101
    base.inc(); quote.inc();     // 102
    base.dec(); quote.dec();     // 101
    base.dec(); quote.dec();     // 100
    
    assertEquals(base.index(), 100);
    assertEquals(quote.index(), 100);
    assertEquals(base.toAbsolute(), quote.toAbsolute(),
        "After mixed inc/dec operations, ticks should remain synchronized");
});

Deno.test("TickIndex: add() operation with positive amount", () => {
    const base = new TickIndex(false, 100);
    const quote = base.clone(true);
    
    base.add(5);
    quote.add(5);
    
    assertEquals(base.index(), 105);
    assertEquals(quote.index(), 105);
    assertEquals(base.toAbsolute(), quote.toAbsolute(),
        "After add(5), ticks should remain synchronized");
});

Deno.test("TickIndex: add() operation with negative amount", () => {
    const base = new TickIndex(false, 100);
    const quote = base.clone(true);
    
    base.add(-7);
    quote.add(-7);
    
    assertEquals(base.index(), 93);
    assertEquals(quote.index(), 93);
    assertEquals(base.toAbsolute(), quote.toAbsolute(),
        "After add(-7), ticks should remain synchronized");
});

Deno.test("TickIndex: opposite operations desynchronize correctly", () => {
    const base = new TickIndex(false, 100);
    const quote = base.clone(true);
    
    // Start synchronized
    assertEquals(base.toAbsolute(), quote.toAbsolute());
    
    // Opposite operations
    base.dec(); // 99
    quote.inc(); // 101
    
    assertEquals(base.index(), 99);
    assertEquals(quote.index(), 101);
    // They should now be 2 ticks apart
    assertEquals(quote.index() - base.index(), 2);
});

Deno.test("TickIndex: verify orientation doesn't affect arithmetic", () => {
    const nonInverted = new TickIndex(false, 100);
    const inverted = new TickIndex(true, 100);
    
    // Inc should work the same for both
    nonInverted.inc();
    inverted.inc();
    
    assertEquals(nonInverted.index(), 101);
    assertEquals(inverted.index(), 101);
    
    // Dec should work the same for both
    nonInverted.dec();
    inverted.dec();
    
    assertEquals(nonInverted.index(), 100);
    assertEquals(inverted.index(), 100);
});

Deno.test("TickIndex: stress test with many operations", () => {
    const base = new TickIndex(false, 0);
    const quote = base.clone(true);
    
    // Apply 1000 random operations
    for (let i = 0; i < 1000; i++) {
        if (Math.random() > 0.5) {
            base.inc();
            quote.inc();
        } else {
            base.dec();
            quote.dec();
        }
    }
    
    // They should still be synchronized
    assertEquals(base.index(), quote.index(),
        "After 1000 random operations, raw indices should match");
    assertEquals(base.toAbsolute(), quote.toAbsolute(),
        "After 1000 random operations, absolute values should match");
});
