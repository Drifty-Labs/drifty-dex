import { assertEquals, assertThrows } from "@std/assert";
import { AMM } from "../amm.ts";
import { TickIndex } from "../ticks.ts";

const makeAmm = () => new AMM(new TickIndex(false, 0));

Deno.test("AMM deposit splits between reserve and current tick", () => {
    const amm = makeAmm();
    amm.deposit({ reserve: 100 });

    // second deposit should split
    amm.deposit({ reserve: 50 });

    const withdrawn = amm.withdraw({ depositedReserve: 150 });
    assertEquals(withdrawn.reserve + withdrawn.inventory, 150);
});

Deno.test("AMM backward withdrawal drains worst inventory", () => {
    const amm = makeAmm();
    amm.deposit({ reserve: 200 });

    const first = amm.withdraw({ depositedReserve: 100 });
    const second = amm.withdraw({ depositedReserve: 100 });

    assertEquals(first.reserve >= second.reserve, true);
});

Deno.test("AMM prevents over-withdrawal", () => {
    const amm = makeAmm();
    amm.deposit({ reserve: 50 });

    assertThrows(() => amm.withdraw({ depositedReserve: 60 }));
});
