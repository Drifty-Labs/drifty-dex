import { AMM } from "./amm.ts";
import { TickIndex } from "./ticks.ts";
import { TwoSided, twoSided } from "./utils.ts";

const STABLE_AMM_CUT = 0.05;
const FEES_CUT = 0.003; // TODO: make dynamic depending on the IL percentage

export type SwapDirection = "base -> quote" | "quote -> base";

export type SwapArgs = {
    qtyIn: number;
    direction: SwapDirection;
};

export type SwapResult = {
    qtyOut: number;
};

export class Pool {
    private stableAMM: TwoSided<AMM>;
    private driftingAMM: TwoSided<AMM>; // TODO: make drifting AMM actually drift

    public swap(args: SwapArgs): SwapResult {
        const fees = args.qtyIn * FEES_CUT;
        let qtyIn = args.qtyIn - fees;

        const stableFees = fees * STABLE_AMM_CUT;
        const driftingFees = fees - stableFees;

        // the price is defined as "how much of the quote asset do I get for a unit of the base asset"
        // so this direction is where we use the price directly and decrement ticks as we go
        if (args.direction === "base -> quote") {
            this.stableAMM["quote"].addInventoryFees(stableFees);
            this.driftingAMM["quote"].addInventoryFees(driftingFees);

            let { qtyOut, reminderIn } = this.stableAMM["base"].swapCurTick({
                direction: "inventory -> reserve",
                qtyIn,
            });

            qtyOut;
        }

        // but this direction is where we use the inverted price and increment ticks as we go
        if (args.direction === "quote -> base") {
            this.stableAMM["base"].addInventoryFees(stableFees);
            this.driftingAMM["base"].addInventoryFees(driftingFees);
        }
    }

    public deposit(side: keyof TwoSided<AMM>, qty: number) {
        const stableCut = qty * STABLE_AMM_CUT;
        const driftingCut = qty - stableCut;

        this.stableAMM[side].deposit({ reserve: stableCut });
        this.driftingAMM[side].deposit({ reserve: driftingCut });
    }

    public withdraw(side: keyof TwoSided<AMM>, qty: number) {
        const stableCut = qty * STABLE_AMM_CUT;
        const driftingCut = qty - stableCut;

        this.stableAMM[side].withdraw({ depositedReserve: stableCut });
        this.driftingAMM[side].withdraw({ depositedReserve: driftingCut });
    }

    constructor(curTickIdx: number) {
        const baseTickIdx = new TickIndex(false, curTickIdx);
        const quoteTickIdx = baseTickIdx.clone(true);

        this.stableAMM = twoSided(new AMM(baseTickIdx), new AMM(quoteTickIdx));
        this.driftingAMM = twoSided(
            new AMM(baseTickIdx),
            new AMM(quoteTickIdx)
        );
    }
}

// TODO: maybe it would be better to make a different "cur tick", with all other cur ticks being mixed together?

export enum SwapOrderPtr {
    BaseStable,
    BaseDrifting,
    QuoteStable,
    QuoteDrifting,
}
