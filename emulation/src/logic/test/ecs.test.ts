import {
    ECs,
    BASE_PRICE,
    basePriceAbsoluteToTick,
    absoluteTickToPrice,
} from "../ecs.ts";
import { assertEquals, assertThrows } from "@std/assert";

const base: bigint = 1_0000_0000_0000_0000_0000_0000_0000_0000n;

Deno.test("ECs.fromString", () => {
    assertEquals(ECs.fromString("1.5").raw, 1n * base + (5n * base) / 10n);
    assertEquals(
        ECs.fromString("123.456").raw,
        123n * base + (456n * base) / 1000n
    );
    assertEquals(ECs.fromString("0.1").raw, base / 10n);
    assertEquals(ECs.fromString("10").raw, 10n * base);
    assertEquals(ECs.fromString("-1.5").raw, -(1n * base + (5n * base) / 10n));
    assertThrows(
        () => ECs.fromString("1.2.3"),
        Error,
        "Expecting a string in format '123.456'"
    );
});

Deno.test("ECs.toString", () => {
    assertEquals(
        ECs.fromString("1.5").toString(),
        "1.50000000000000000000000000000000"
    );
    assertEquals(ECs.fromString("1.5").toString(2), "1.50");
    assertEquals(ECs.fromString("0.123456789").toString(10), "0.1234567890");
    assertEquals(
        ECs.fromString("-1.5").toString(),
        "-1.50000000000000000000000000000000"
    );
});

Deno.test("ECs.toNumber", () => {
    assertEquals(ECs.fromString("1.5").toNumber(), 1.5);
});

Deno.test("ECs.clone", () => {
    const a = ECs.fromString("1.23");
    const b = a.clone();
    assertEquals(a.raw, b.raw);
    assertEquals(a, b);
});

Deno.test("ECs.add", () => {
    const a = ECs.fromString("1.5");
    const b = ECs.fromString("2.5");
    assertEquals(a.add(b).raw, ECs.fromString("4.0").raw);

    const c = ECs.fromString("-1.5");
    assertEquals(c.add(b).raw, ECs.fromString("1.0").raw);
});

Deno.test("ECs.addAssign", () => {
    const a = ECs.fromString("1.5");
    const b = ECs.fromString("2.5");
    a.addAssign(b);
    assertEquals(a.raw, ECs.fromString("4.0").raw);
});

Deno.test("ECs.sub", () => {
    const a = ECs.fromString("3.5");
    const b = ECs.fromString("1.5");
    assertEquals(a.sub(b).raw, ECs.fromString("2.0").raw);

    const c = ECs.fromString("-1.5");

    assertEquals(c.sub(b).raw, ECs.fromString("-3.0").raw);
});

Deno.test("ECs.subAssign", () => {
    const a = ECs.fromString("3.5");
    const b = ECs.fromString("1.5");
    a.subAssign(b);
    assertEquals(a.raw, ECs.fromString("2.0").raw);
});

Deno.test("ECs.mul", () => {
    const a = ECs.fromString("1.5");
    const b = ECs.fromString("2");
    assertEquals(a.mul(b).raw, ECs.fromString("3.0").raw);
    assertEquals(a.mul(2).raw, ECs.fromString("3.0").raw);
});

Deno.test("ECs.mulAssign", () => {
    const a = ECs.fromString("1.5");
    let b = a.clone();
    const c = ECs.fromString("2");

    a.mulAssign(c);
    assertEquals(a.raw, ECs.fromString("3.0").raw);

    b.mulAssign(2);
    assertEquals(b.raw, ECs.fromString("3.0").raw);
});

Deno.test("ECs.div", () => {
    const a = ECs.fromString("3");
    const b = ECs.fromString("2");
    assertEquals(a.div(b).raw, ECs.fromString("1.5").raw);
    assertEquals(a.div(2).raw, ECs.fromString("1.5").raw);
});

Deno.test("ECs.divAssign", () => {
    const a = ECs.fromString("3");
    let b = a.clone();
    const c = ECs.fromString("2");

    a.divAssign(c);
    assertEquals(a.raw, ECs.fromString("1.5").raw);

    b.divAssign(2);
    assertEquals(b.raw, ECs.fromString("1.5").raw);
});

Deno.test("ECs.mod", () => {
    const a = ECs.fromString("3.5");
    const b = ECs.fromString("2");
    assertEquals(a.mod(b).raw, ECs.fromString("1.5").raw);
});

Deno.test("ECs.modAssign", () => {
    const a = ECs.fromString("3.5");
    const b = ECs.fromString("2");
    a.modAssign(b);
    assertEquals(a.raw, ECs.fromString("1.5").raw);
});

Deno.test("ECs.sign", () => {
    assertEquals(ECs.fromString("10").sign(), 1);
    assertEquals(ECs.fromString("-10").sign(), -1);
    assertEquals(ECs.zero().sign(), 1);
});

Deno.test("ECs.isNegative, isPositive, isZero", () => {
    assertEquals(ECs.fromString("10").isPositive(), true);
    assertEquals(ECs.fromString("-10").isNegative(), true);
    assertEquals(ECs.zero().isZero(), true);
    assertEquals(ECs.fromString("10").isNegative(), false);
    assertEquals(ECs.fromString("-10").isPositive(), false);
});

Deno.test("ECs.negate", () => {
    assertEquals(ECs.fromString("10").negate().raw, ECs.fromString("-10").raw);
    assertEquals(ECs.fromString("-10").negate().raw, ECs.fromString("10").raw);
});

Deno.test("ECs.abs", () => {
    assertEquals(ECs.fromString("-10").abs().raw, ECs.fromString("10").raw);
    assertEquals(ECs.fromString("10").abs().raw, ECs.fromString("10").raw);
});

Deno.test("ECs.inv", () => {
    const a = ECs.fromString("2");
    assertEquals(a.inv().raw, ECs.fromString("0.5").raw);
});

Deno.test("ECs.pow2", () => {
    const a = ECs.fromString("3");
    assertEquals(a.pow2().raw, ECs.fromString("9").raw);
});

Deno.test("ECs.sqrt", () => {
    const a = ECs.fromString("9");
    assertEquals(a.sqrt().raw, ECs.fromString("3").raw);
    const b = ECs.fromString("2");
    // We test for a high precision here, not for equality
    const sqrt2 = b.sqrt();
    assertEquals(sqrt2.gt(ECs.fromString("1.414213562373095048")), true);
    assertEquals(sqrt2.lt(ECs.fromString("1.414213562373095049")), true);
});

Deno.test("ECs.pow", () => {
    const a = ECs.fromString("2");
    assertEquals(a.pow(3).raw, ECs.fromString("8").raw);
    assertEquals(a.pow(-2).raw, ECs.fromString("0.25").raw);
});

Deno.test("ECs comparisons", () => {
    const a = ECs.fromString("1");
    const b = ECs.fromString("2");
    const c = ECs.fromString("1");

    assertEquals(a.eq(c), true);
    assertEquals(a.eq(b), false);
    assertEquals(a.lt(b), true);
    assertEquals(b.gt(a), true);
    assertEquals(a.le(b), true);
    assertEquals(a.le(c), true);
    assertEquals(b.ge(a), true);
    assertEquals(b.ge(c), true);
});

Deno.test("ECs static factories", () => {
    assertEquals(ECs.one().raw, base);
    assertEquals(ECs.two().raw, base * 2n);
    assertEquals(ECs.half().raw, base / 2n);
    assertEquals(ECs.zero().raw, 0n);
    assertEquals(ECs.b(5n).raw, base * 5n);
});

Deno.test("ECs.toShortString", () => {
    assertEquals(ECs.b(1_000_000_000_000n).toShortString(), "1.00T");
    assertEquals(ECs.b(1_000_000_000n).toShortString(), "1.00B");
    assertEquals(ECs.b(1_000_000n).toShortString(), "1.00M");
    assertEquals(ECs.b(1_000n).toShortString(), "1.00K");
    assertEquals(ECs.b(100n).toShortString(), "100.00");
    assertEquals(ECs.b(10n).toShortString(), "10.000");
    assertEquals(ECs.one().toShortString(), "1.0000");
});

Deno.test("priceToTick", () => {
    assertEquals(basePriceAbsoluteToTick(ECs.one()), 0);
    assertEquals(basePriceAbsoluteToTick(BASE_PRICE), 1);
    assertEquals(basePriceAbsoluteToTick(BASE_PRICE.pow(10)), 10);
    assertEquals(basePriceAbsoluteToTick(BASE_PRICE.pow(10000)), 10000);
});
