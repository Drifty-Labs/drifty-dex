import { assertEquals, assertThrows } from "jsr:@std/assert";
import { TickIndexFactory } from "../ticks.ts";
import { MAX_TICK, MIN_TICK } from "../utils.ts";

Deno.test("TickIndexFactory - Normal", () => {
    const factory = new TickIndexFactory(false);
    const tick = factory.make(0);
    assertEquals(tick.toAbsolute(), 0);
    
    const min = factory.min();
    assertEquals(min.toAbsolute(), MIN_TICK);
    
    const max = factory.max();
    assertEquals(max.toAbsolute(), MAX_TICK);
});

Deno.test("TickIndexFactory - Inverted", () => {
    const factory = new TickIndexFactory(true);
    const tick = factory.make(0);
    assertEquals(tick.toAbsolute(), 0);
    
    // For inverted ticks:
    // min() creates a tick with relative index -MAX_TICK
    // toAbsolute() converts -(-MAX_TICK) -> MAX_TICK
    const min = factory.min();
    assertEquals(min.toAbsolute(), MAX_TICK);
    
    // max() creates a tick with relative index -MIN_TICK
    // toAbsolute() converts -(-MIN_TICK) -> MIN_TICK
    const max = factory.max();
    assertEquals(max.toAbsolute(), MIN_TICK);
});

Deno.test("TickIndex - Basic Operations (Normal)", () => {
    const factory = new TickIndexFactory(false);
    const tick = factory.make(100);

    tick.inc();
    assertEquals(tick.toAbsolute(), 101);

    tick.dec();
    assertEquals(tick.toAbsolute(), 100);

    tick.add(10);
    assertEquals(tick.toAbsolute(), 110);
    
    tick.sub(5);
    assertEquals(tick.toAbsolute(), 105);
});

Deno.test("TickIndex - Basic Operations (Inverted)", () => {
    const factory = new TickIndexFactory(true);
    const tick = factory.make(100);
    // Internal relative index is -100

    // inc() increases relative index: -100 -> -99
    // toAbsolute() returns -(-99) = 99
    tick.inc();
    assertEquals(tick.toAbsolute(), 99);

    // dec() decreases relative index: -99 -> -100
    // toAbsolute() returns -(-100) = 100
    tick.dec();
    assertEquals(tick.toAbsolute(), 100);

    // add(10) increases relative index: -100 -> -90
    // toAbsolute() returns -(-90) = 90
    tick.add(10);
    assertEquals(tick.toAbsolute(), 90);
    
    // sub(5) decreases relative index: -90 -> -95
    // toAbsolute() returns -(-95) = 95
    tick.sub(5);
    assertEquals(tick.toAbsolute(), 95);
});

Deno.test("TickIndex - Comparison (Normal)", () => {
    const factory = new TickIndexFactory(false);
    const t100 = factory.make(100);
    const t200 = factory.make(200);

    assertEquals(t100.lt(t200), true);
    assertEquals(t100.le(t200), true);
    assertEquals(t100.gt(t200), false);
    assertEquals(t100.ge(t200), false);
    assertEquals(t100.eq(t200), false);
    assertEquals(t100.eq(factory.make(100)), true);
});

Deno.test("TickIndex - Comparison (Inverted)", () => {
    const factory = new TickIndexFactory(true);
    // t100: relative -100
    // t200: relative -200
    const t100 = factory.make(100);
    const t200 = factory.make(200);

    // -100 > -200
    // So t100 is GREATER than t200 in relative terms (higher local price)
    
    assertEquals(t200.lt(t100), true);
    assertEquals(t200.le(t100), true);
    
    assertEquals(t100.gt(t200), true);
    assertEquals(t100.ge(t200), true);
});

Deno.test("TickIndex - Synchronization & Inversion", () => {
    const normalFactory = new TickIndexFactory(false);
    const invertedFactory = new TickIndexFactory(true);

    const startIdx = 1000;
    const normalTick = normalFactory.make(startIdx);
    const invertedTick = invertedFactory.make(startIdx);

    // 1. Check Clone
    const clonedInverted = normalTick.clone(true);
    assertEquals(clonedInverted.toAbsolute(), startIdx);
    // Verify it behaves like an inverted tick
    // relative index is -1000. inc() -> -999. abs -> 999.
    clonedInverted.inc();
    assertEquals(clonedInverted.toAbsolute(), startIdx - 1);

    // 2. Opposite Movement (The core requirement)
    // Reset
    const tBase = normalFactory.make(startIdx);
    const tQuote = invertedFactory.make(startIdx);

    // Base: inc() -> relative 1001 -> abs 1001
    tBase.inc();
    
    // Quote: dec() -> relative -1001 -> abs 1001
    // Wait, if we want them to meet at the same absolute value:
    // Base moves UP (Price Up) -> 101
    // Quote moves DOWN (Price Down) -> -101 (relative) -> 101 (abs)
    // So Base.inc() and Quote.dec() should align.
    tQuote.dec();

    assertEquals(tBase.toAbsolute(), startIdx + 1);
    assertEquals(tQuote.toAbsolute(), startIdx + 1);
    
    // Verify they point to the same absolute value
    assertEquals(tBase.toAbsolute(), tQuote.toAbsolute());
});

Deno.test("TickIndex - Distance", () => {
    const factory = new TickIndexFactory(false);
    const t1 = factory.make(100);
    const t2 = factory.make(150);
    assertEquals(t1.distance(t2), 50);
    assertEquals(t2.distance(t1), 50);

    const invFactory = new TickIndexFactory(true);
    const i1 = invFactory.make(100); // rel -100
    const i2 = invFactory.make(150); // rel -150
    assertEquals(i1.distance(i2), 50);
});

Deno.test("TickIndex - Bounds Check", () => {
    const factory = new TickIndexFactory(false);
    
    assertThrows(() => {
        factory.make(MAX_TICK + 1);
    });

    assertThrows(() => {
        factory.make(MIN_TICK - 1);
    });

    const max = factory.max();
    assertThrows(() => {
        max.inc();
    });
});
