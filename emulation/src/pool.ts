import { AMM } from "./amm.ts";
import { AMMSwapDirection } from "./cur-tick.ts";
import { TickIndex } from "./ticks.ts";
import { panic, Side, TwoSided, twoSided } from "./utils.ts";

const STABLE_AMM_CUT = 0.05;
const MIN_FEES = 0.0001;
const MAX_FEES = 0.1;

export type SwapDirection = "base -> quote" | "quote -> base";

export type SwapArgs = {
    qtyIn: number;
    direction: SwapDirection;
};

export type SwapResult = {
    qtyOut: number;
};

/**
 * Represents a liquidity pool, which is the main entry point for interacting with the DEX.
 * A pool consists of two pairs of AMMs: a stable AMM and a drifting AMM for both the base and quote assets.
 * This design allows for both stable, wide-range liquidity and concentrated, dynamic liquidity.
 */
export class Pool {
    private stableAMM: TwoSided<AMM>;
    private driftingAMM: TwoSided<AMM>; // TODO: make drifting AMM actually drift

    /**
     * Calculates the average impermanent loss (IL) across all AMMs in the pool.
     * @returns The average IL as a percentage (0 to 1).
     */
    public getAvgIl(): number {
        const totalReserve0 =
            this.stableAMM.base.getDepositedReserve() +
            this.driftingAMM.base.getDepositedReserve();
        const il01 =
            (this.stableAMM.base.getIl() *
                this.stableAMM.base.getDepositedReserve()) /
            totalReserve0;
        const il02 =
            (this.driftingAMM.base.getIl() *
                this.driftingAMM.base.getDepositedReserve()) /
            totalReserve0;
        const il0 = il01 + il02;

        const totalReserve1 =
            this.stableAMM.quote.getDepositedReserve() +
            this.driftingAMM.quote.getDepositedReserve();
        const il11 =
            (this.stableAMM.quote.getIl() *
                this.stableAMM.quote.getDepositedReserve()) /
            totalReserve1;
        const il12 =
            (this.driftingAMM.quote.getIl() *
                this.driftingAMM.quote.getDepositedReserve()) /
            totalReserve1;
        const il1 = il11 + il12;

        return (il0 + il1) / 2;
    }

    /**
     * Calculates the dynamic fees for a swap based on the average impermanent loss.
     * The higher the IL, the higher the fees.
     * @returns The fee rate as a percentage (0 to 1).
     */
    public getFees(): number {
        const il = this.getAvgIl();

        return MIN_FEES + (il <= 0.9 ? (MAX_FEES * il) / 0.9 : MAX_FEES);
    }

    /**
     * Executes a swap in the pool.
     * Fees are calculated and deducted from the input quantity.
     * The fees are then distributed to the appropriate AMMs for IL recovery.
     * @param args The swap arguments.
     * @returns The result of the swap, including the output quantity.
     */
    public swap(args: SwapArgs): SwapResult {
        const fees = args.qtyIn * this.getFees();
        const qtyIn = args.qtyIn - fees;

        const stableFees = fees * STABLE_AMM_CUT;
        const driftingFees = fees - stableFees;

        // the price is defined as "how much of the quote asset do I get for a unit of the base asset"
        // so this direction is where we use the price directly and decrement ticks as we go
        if (args.direction === "base -> quote") {
            this.stableAMM["quote"].curTick().addInventoryFees(stableFees);
            this.driftingAMM["quote"].curTick().addInventoryFees(driftingFees);

            return {
                qtyOut: this._swap(qtyIn, args.direction),
            };
        } else {
            this.stableAMM["base"].curTick().addInventoryFees(stableFees);
            this.driftingAMM["base"].curTick().addInventoryFees(driftingFees);

            return {
                qtyOut: this._swap(qtyIn, args.direction),
            };
        }
    }

    /**
     * Deposits liquidity into one side of the pool.
     * The liquidity is split between the stable and drifting AMMs according to `STABLE_AMM_CUT`.
     * @param side The side of the pool to deposit into (`base` or `quote`).
     * @param qty The amount of liquidity to deposit.
     */
    public deposit(side: keyof TwoSided<AMM>, qty: number) {
        const stableCut = qty * STABLE_AMM_CUT;
        const driftingCut = qty - stableCut;

        this.stableAMM[side].deposit({ reserve: stableCut });
        this.driftingAMM[side].deposit({ reserve: driftingCut });
    }

    /**
     * Withdraws liquidity from one side of the pool.
     * The withdrawal amount is split between the stable and drifting AMMs.
     * @param side The side of the pool to withdraw from (`base` or `quote`).
     * @param qty The amount of liquidity to withdraw.
     */
    public withdraw(side: keyof TwoSided<AMM>, qty: number) {
        const stableCut = qty * STABLE_AMM_CUT;
        const driftingCut = qty - stableCut;

        this.stableAMM[side].withdraw({ depositedReserve: stableCut });
        this.driftingAMM[side].withdraw({ depositedReserve: driftingCut });
    }

    /**
     * The internal swap function that iterates through the AMMs to execute the swap.
     * It continues swapping until the input quantity is fully consumed.
     * If a tick is exhausted, it moves to the next available tick.
     * @param qtyIn The input quantity for the swap.
     * @param direction The direction of the swap.
     * @returns The total output quantity from the swap.
     */
    private _swap(qtyIn: number, direction: SwapDirection): number {
        let qtyOut = 0;

        const baseDirection: AMMSwapDirection =
            direction === "base -> quote"
                ? "reserve -> inventory"
                : "inventory -> reserve";

        const quoteDirection: AMMSwapDirection =
            direction === "quote -> base"
                ? "reserve -> inventory"
                : "inventory -> reserve";

        const amms: [AMM, AMMSwapDirection][] = [
            [this.stableAMM.base, baseDirection],
            [this.driftingAMM.base, baseDirection],
            [this.stableAMM.quote, quoteDirection],
            [this.driftingAMM.quote, quoteDirection],
        ];

        // The swap loop continues as long as there is input quantity to be swapped.
        // It iterates through all four AMMs, attempting to swap a portion of the input quantity in each.
        // If a swap is successful, the `hasAny` flag is set to true.
        // If the input quantity is fully swapped, the loop returns the total output quantity.
        // If an entire tick is consumed across all AMMs without filling the swap, the tick is incremented or decremented,
        // and the loop continues on the new tick.
        while (true) {
            let hasAny = false;

            for (const [amm, direction] of amms) {
                const { qtyOut: q, reminderIn } = amm.curTick().swap({
                    direction,
                    qtyIn,
                });

                if (reminderIn < qtyIn) {
                    hasAny = true;
                }

                qtyIn = reminderIn;
                qtyOut += q;

                if (qtyIn === 0) return qtyOut;
            }

            if (!hasAny) {
                if (baseDirection === "reserve -> inventory") {
                    this.stableAMM.base.curTick().increment();
                    this.stableAMM.quote.curTick().decrement();

                    this.driftingAMM.base.curTick().increment();
                    this.driftingAMM.quote.curTick().decrement();
                } else {
                    this.stableAMM.base.curTick().decrement();
                    this.stableAMM.quote.curTick().increment();

                    this.driftingAMM.base.curTick().decrement();
                    this.driftingAMM.quote.curTick().increment();
                }

                const indices = amms.map(([it, _]) =>
                    it.curTick().index().toAbsolute()
                );
                if (!indices.every((it) => it === indices[0])) {
                    panic(
                        "After tick move some ticks are different, while should be the same!"
                    );
                }
            }
        }
    }

    /**
     * Creates a new `Pool`.
     * @param curTickIdx The initial tick index for the pool.
     */
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
