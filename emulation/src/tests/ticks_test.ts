import { assertEquals, assertThrows } from "@std/assert";
import { TickIndex, TickIndexFactory } from "../ticks.ts";

Deno.test("TickIndexFactory respects orientation", () => {
    const normal = new TickIndexFactory(false);
    const inverted = new TickIndexFactory(true);

    assertEquals(normal.make(5).index(), 5);
    assertEquals(inverted.make(5).index(), 5);
    assertEquals(normal.min().index(), -887272);
    assertEquals(inverted.max().index(), 887272);
});

Deno.test("TickIndex clone can invert orientation", () => {
    const base = new TickIndex(false, 10);
    const quote = base.clone(true);

    assertEquals(base.index(), 10);
    assertEquals(quote.index(), 10);
    assertEquals(base.getPrice(), 1.0001 ** 10);
    assertEquals(quote.getPrice(), 1.0001 ** 10);
});

Deno.test("TickIndex comparisons enforce orientation", () => {
    const baseLeft = new TickIndex(false, 5);
    const baseRight = new TickIndex(false, 8);

    assertEquals(baseLeft.lt(baseRight), true);
    assertEquals(baseRight.gt(baseLeft), true);

    assertThrows(() => baseLeft.eq(baseRight.clone(true)));
});

Deno.test("TickIndex inc/dec honor inversion", () => {
    const base = new TickIndex(false, 0);
    base.inc();
    assertEquals(base.index(), 1);
    base.dec();
    assertEquals(base.index(), 0);

    const quote = new TickIndex(true, 0);
    quote.inc();
    assertEquals(quote.index(), -1);
    quote.dec();
    assertEquals(quote.index(), 0);
});
