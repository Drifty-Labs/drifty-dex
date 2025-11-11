import { AMM } from "./amm.ts";
import { PricePlane } from "./ticks.ts";
import { TwoSided, twoSided } from "./utils.ts";

export class Pool {
    private amm = twoSided(new AMM(), new AMM());
    private plane: PricePlane;

    public swap(qty: number, direction: SwapDirection) {
        // the price is defined as "how much of the quote asset do I get for a unit of the base asset"
        // so this direction is where we use the price directly and decrement ticks as we go
        if (direction === "base -> quote") {
        }

        // but this direction is where we use the inverted price and increment ticks as we go
        if (direction === "quote -> base") {
        }
    }

    public deposit(side: keyof TwoSided<AMM>, qty: number) {
        this.amm[side].deposit(qty);
    }

    constructor(curTick: number) {
        this.plane = new PricePlane(curTick);
    }
}
