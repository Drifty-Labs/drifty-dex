import { assertEquals, assert } from "@std/assert";
import { CurrentTick } from "../cur-tick.ts";
import { Liquidity } from "../liquidity.ts";
import { absoluteTickToPrice, almostEq } from "../utils.ts";

Deno.test("Symmetry test", () => {
    const liquidity = new Liquidity("base", false, false);
    liquidity.reserve.init(1000, 1, 110);

    const curTick = new CurrentTick("base", false, 0, liquidity, false);
    curTick.nextReserveTick();

    const initialReserve = curTick.getLiquidity().reserve;
    const initialInventory = curTick.getLiquidity().inventory;

    const originalInventory = 100;
    let qtyToSwap = originalInventory;
    let spentInventory = 0;

    let forwardAcquiredInventory = 0;

    // Forward swaps
    let step = 0;
    while (qtyToSwap > 0) {
        step++;
        const { qtyOut, reminderIn } = curTick.swap({
            direction: "inventory -> reserve",
            qtyIn: qtyToSwap,
        });
        spentInventory += qtyToSwap - reminderIn;
        forwardAcquiredInventory += qtyOut;
        qtyToSwap = reminderIn;

        if (qtyToSwap > 0) {
            curTick.nextReserveTick();
        }
    }

    const maxStep = step;
    let backwardAcquiredReserve = 0;
    let qtyInBack = forwardAcquiredInventory;

    // Backward swaps
    step = 0;
    while (qtyInBack > 0) {
        step++;
        assert(step <= maxStep);
        const { qtyOut, reminderIn, tickExhausted } = curTick.swap({
            direction: "reserve -> inventory",
            qtyIn: qtyInBack,
        });
        backwardAcquiredReserve += qtyOut;
        qtyInBack = reminderIn;

        if (qtyInBack > 0) {
            curTick.nextInventoryTick();
        }
    }

    const finalReserve = curTick.getLiquidity().reserve;
    const finalInventory = curTick.getLiquidity().inventory;

    assert(almostEq(initialReserve, finalReserve));
    assert(almostEq(initialInventory, finalInventory));
});

Deno.test("Slippage similar", () => {
    // 10 ticks, 100 quote liquidity each, moving from right to left

    const liquidityQuote = new Liquidity("quote", false, false);
    liquidityQuote.reserve.init(1000, 0, 9);

    const curTickQuote = new CurrentTick(
        "quote",
        false,
        10,
        liquidityQuote,
        false
    );

    curTickQuote.nextReserveTick();

    // using a slightly smaller
    const baseIn = 99;
    const expectedQuoteOut =
        baseIn * absoluteTickToPrice(curTickQuote.index, "quote", "inventory");

    const { qtyOut: quoteOut } = curTickQuote.swap({
        direction: "inventory -> reserve",
        qtyIn: baseIn,
    });

    const slippageQuote = 1 - quoteOut / expectedQuoteOut;

    // 10 ticks, 100 quote liquidity each, moving from left to right
    const liquidityBase = new Liquidity("base", false, false);
    liquidityBase.reserve.init(1000, 11, 20);

    const curTickBase = new CurrentTick(
        "base",
        false,
        10,
        liquidityBase,
        false
    );

    curTickBase.nextReserveTick();

    const quoteIn = 100;
    const expectedBaseOut =
        quoteIn * absoluteTickToPrice(curTickBase.index, "base", "inventory");

    const { qtyOut: baseOut } = curTickBase.swap({
        direction: "inventory -> reserve",
        qtyIn: quoteIn,
    });

    const slippageBase = 1 - baseOut / expectedBaseOut;

    console.log(expectedQuoteOut, quoteOut);
    console.log(expectedBaseOut, baseOut);
    console.log(slippageQuote, slippageBase);
});
