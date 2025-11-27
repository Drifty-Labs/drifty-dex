import { AMM } from "./amm.ts";
import { type AMMSwapDirection } from "./cur-tick.ts";
import { TickIndex } from "./ticks.ts";
import {
    almostEq,
    panic,
    TEN_PERCENT_TICKS,
    tickToPrice,
    type TwoSided,
} from "./utils.ts";
import { OrderedMap } from "@js-sdsl/ordered-map";

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
 * Top-level orchestrator that exposes a dual-AMM pool (stable + drifting per
 * side). The stable AMM covers the whole price curve, while the drifting AMM is
 * expected to follow the rules described earlier (left bound equals opposite
 * worst inventory tick, right bound equals current tick - 1).
 *
 * Responsibilities:
 * - Route deposits/withdrawals proportionally between stable and drifting AMMs.
 * - Apply dynamic fees that scale with aggregated IL.
 * - Route swaps across four AMMs in a deterministic order, keeping tick indices
 *   synchronized for both base and quote sides.
 */
export class Pool {
    private stableAMM: TwoSided<AMM>;
    private driftingAMM: TwoSided<AMM>;

    public clone() {
        const p = new Pool(this.driftingAMM.base.curTick.index.toAbsolute());

        p.stableAMM.base = this.stableAMM.base.clone();
        p.stableAMM.quote = this.stableAMM.quote.clone();

        p.driftingAMM.base = this.driftingAMM.base.clone();
        p.driftingAMM.quote = this.driftingAMM.quote.clone();

        return p;
    }

    /**
     * Rebases the drifting AMMs to match the opposite side's inventory.
     * This should be called periodically by an external keeper.
     */
    private drift() {
        const baseWorst = this.driftingAMM.base.getRightInventoryTick();

        // For quote drifting AMM, left bound is opposite (base) worst inventory tick
        // Base is Negated, Quote is Positive. So we must Negate Base index to get Quote Target.
        if (baseWorst !== undefined) {
            this.driftingAMM.quote.drift(baseWorst.idx.clone(true));
        }

        const quoteWorst = this.driftingAMM.quote.getRightInventoryTick();

        // For base drifting AMM, left bound is opposite (quote) worst inventory tick
        // Quote is Positive, Base is Negated. So we must Negate Quote index to get Base Target.
        if (quoteWorst !== undefined) {
            this.driftingAMM.base.drift(quoteWorst.idx.clone(true));
        }
    }

    /**
     * Executes a swap, takes fees upfront, and feeds the RecoveryBins of the
     * AMMs that are about to receive inventory (quote AMMs when buying quote,
     * base AMMs when buying base).
     */
    public swap(args: SwapArgs): SwapResult {
        const fees = args.qtyIn * this.getFees();
        const qtyIn = args.qtyIn - fees;

        /*     console.log(
            `Incoming ${args.direction} swap, qty = ${qtyIn} ${
                args.direction === "base -> quote" ? "base" : "quote"
            }, fees = ${fees}, curtick: ${this.driftingAMM.base.curTick.index.toAbsolute()}`
        ); */

        const stableFees = fees * STABLE_AMM_CUT;
        const driftingFees = fees - stableFees;

        let qtyOut: number = 0;

        if (args.direction === "base -> quote") {
            this.stableAMM["quote"].curTick.addInventoryFees(stableFees);
            this.driftingAMM["quote"].curTick.addInventoryFees(driftingFees);

            qtyOut = this._swap(qtyIn, args.direction);
        } else {
            this.stableAMM["base"].curTick.addInventoryFees(stableFees);
            this.driftingAMM["base"].curTick.addInventoryFees(driftingFees);

            qtyOut = this._swap(qtyIn, args.direction);
        }

        /*   console.log(
            `Received ${qtyOut} ${
                args.direction === "base -> quote" ? "quote" : "base"
            }, curtick: ${this.driftingAMM.base.curTick.index.toAbsolute()}`
        );
 */
        this.drift();

        return { qtyOut };
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

        const oppositeSide = side === "base" ? "quote" : "base";
        const worstInventory =
            this.driftingAMM[oppositeSide].getRightInventoryTick();

        const tenPercent =
            this.driftingAMM[oppositeSide].curTick.index.clone(true);
        tenPercent.sub(TEN_PERCENT_TICKS);

        const leftBound = worstInventory
            ? worstInventory.idx.clone()
            : tenPercent;

        this.driftingAMM[side].deposit({ reserve: driftingCut, leftBound });
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
     * Internal swap scheduler shared by both directions.
     *
     * - Iterates over all four AMMs in a fixed order, letting each try to fill
     *   as much of `qtyIn` as it can on the current tick.
     * - If none of them make progress (`hasAny === false`), the function moves
     *   ticks forward/backward in lockstep (base increments while quote
     *   decrements for base->quote swaps, and vice versa) until new liquidity is
     *   available.
     * - After any tick move it re-validates that all AMMs point at the same
     *   absolute index to guarantee price coherence.
     */
    private _swap(qtyIn: number, direction: SwapDirection): number {
        let qtyOut = 0;

        // For "base -> quote" swap: user gives base, receives quote
        // - Base AMM receives Base (Reserve) → "reserve -> inventory"
        // - Quote AMM receives Base (Inventory) → "inventory -> reserve"
        let baseDirection: AMMSwapDirection;
        let quoteDirection: AMMSwapDirection;

        if (direction === "base -> quote") {
            // User sells Base (Reserve) -> AMM buys Base (Reserve)
            // Base AMM: Reserve -> Inventory (Receives Reserve, Pays Inventory)
            baseDirection = "reserve -> inventory";
            // Quote AMM: Inventory -> Reserve (Receives Inventory, Pays Reserve)
            quoteDirection = "inventory -> reserve";
        } else {
            // User sells Quote (Reserve) -> AMM buys Quote (Reserve)
            // Base AMM: Inventory -> Reserve (Receives Inventory, Pays Reserve)
            baseDirection = "inventory -> reserve";
            // Quote AMM: Reserve -> Inventory (Receives Reserve, Pays Reserve)
            quoteDirection = "reserve -> inventory";
        }

        const amms: [AMM, AMMSwapDirection][] = [
            [this.stableAMM.base, baseDirection],
            [this.driftingAMM.base, baseDirection],
            [this.stableAMM.quote, quoteDirection],
            [this.driftingAMM.quote, quoteDirection],
        ];

        while (!almostEq(qtyIn, 0)) {
            let hasAny = false;

            // Keep swapping with each AMM until it's fully exhausted
            for (const [amm, direction] of amms) {
                while (!almostEq(qtyIn, 0)) {
                    const {
                        qtyOut: q,
                        reminderIn,
                        recoveredReserve,
                    } = amm.curTick.swap({
                        direction,
                        qtyIn,
                    });

                    amm.deposit({ reserve: recoveredReserve });

                    if (reminderIn < qtyIn) {
                        hasAny = true;
                        qtyIn = reminderIn;
                        qtyOut += q;
                    } else {
                        // This AMM can't provide anything, move to next
                        break;
                    }
                }

                if (almostEq(qtyIn, 0)) return qtyOut;
            }

            // Check if we should move ticks
            // We can only move if ALL AMMs have exhausted the asset they PROVIDE
            if (!hasAny && !almostEq(qtyIn, 0)) {
                // Move ALL AMMs together
                if (direction === "base -> quote") {
                    this.stableAMM.base.curTick.nextInventoryTick();
                    this.driftingAMM.base.curTick.nextInventoryTick();

                    this.stableAMM.quote.curTick.nextReserveTick();
                    this.driftingAMM.quote.curTick.nextReserveTick();
                } else {
                    this.stableAMM.base.curTick.nextReserveTick();
                    this.driftingAMM.base.curTick.nextReserveTick();

                    this.stableAMM.quote.curTick.nextInventoryTick();
                    this.driftingAMM.quote.curTick.nextInventoryTick();
                }

                const indices = amms.map(([it, _]) =>
                    Math.abs(it.curTick.index.index())
                );
                const allSame = indices.every((idx) => idx === indices[0]);
                if (!allSame) {
                    panic(
                        `After tick move some ticks are different, while should be the same! ${indices}`
                    );
                }
            } else if (!hasAny) {
                panic("No progress and no qty left - swap complete");
            }
        }

        return qtyOut;
    }

    /**
     * Calculates the average impermanent loss (IL) across all AMMs in the pool.
     * @returns The average IL as a percentage (0 to 1).
     */
    public getAvgIl(): number {
        const totalReserve0 =
            this.stableAMM.base.getDepositedReserve() +
            this.driftingAMM.base.getDepositedReserve();

        const il01 =
            (this.stableAMM.base.il *
                this.stableAMM.base.getDepositedReserve()) /
            totalReserve0;

        const il02 =
            (this.driftingAMM.base.il *
                this.driftingAMM.base.getDepositedReserve()) /
            totalReserve0;

        const il0 = il01 + il02;

        const totalReserve1 =
            this.stableAMM.quote.getDepositedReserve() +
            this.driftingAMM.quote.getDepositedReserve();

        const il11 =
            (this.stableAMM.quote.il *
                this.stableAMM.quote.getDepositedReserve()) /
            totalReserve1;

        const il12 =
            (this.driftingAMM.quote.il *
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
        return this.calculateFees(il);
    }

    private calculateFees(il: number): number {
        return MIN_FEES + (il <= 0.9 ? (MAX_FEES * il) / 0.9 : MAX_FEES);
    }

    public getLiquidityDigest(tickSpan: number): LiquidityDigestAbsolute {
        const db = this.driftingAMM.base.getLiquidityDigest(tickSpan);
        const dq = this.driftingAMM.quote.getLiquidityDigest(tickSpan);
        const sb = this.stableAMM.base.getLiquidityDigest(tickSpan);
        const sq = this.stableAMM.quote.getLiquidityDigest(tickSpan);

        let maxBaseTickQty = 0;

        // combining all base ticks

        const allBaseTicks = [
            ...db.reserve,
            ...dq.inventory,
            ...sb.reserve,
            ...sq.inventory,
        ];
        const baseTicks: OrderedMap<number, number> = new OrderedMap();

        for (const tick of allBaseTicks) {
            const idx = tick.tickIdx.toAbsolute();

            const prev = baseTicks.getElementByKey(idx) ?? 0;
            const qty = prev + tick.qty;
            baseTicks.setElement(idx, qty);

            maxBaseTickQty = Math.max(maxBaseTickQty, qty);
        }

        // combining all quote ticks

        const allQuoteTicks = [
            ...dq.reserve,
            ...db.inventory,
            ...sq.reserve,
            ...sb.inventory,
        ];
        const quoteTicks: OrderedMap<number, number> = new OrderedMap();

        for (const tick of allQuoteTicks) {
            const idx = tick.tickIdx.toAbsolute();

            const prev = quoteTicks.getElementByKey(idx) ?? 0;
            const qty = prev + tick.qty;
            quoteTicks.setElement(idx, qty);

            const repsectiveBaseQty = qty / tickToPrice(idx);
            maxBaseTickQty = Math.max(maxBaseTickQty, repsectiveBaseQty);
        }

        // collect and verify current tick idx invariant

        const curIdx = db.curTick.idx.toAbsolute();
        if (
            db.curTick.idx.toAbsolute() !== curIdx ||
            dq.curTick.idx.toAbsolute() !== curIdx ||
            sb.curTick.idx.toAbsolute() !== curIdx ||
            sq.curTick.idx.toAbsolute() !== curIdx
        ) {
            panic(`Ticks don't match`);
        }

        // collect all liquidity from the current tick

        const baseCurTickLiq =
            db.curTick.reserve +
            dq.curTick.inventory +
            sb.curTick.reserve +
            sq.curTick.inventory;

        const quoteCurTickLiq =
            dq.curTick.reserve +
            db.curTick.inventory +
            sq.curTick.reserve +
            sb.curTick.inventory;

        // collect all collateral

        const baseRecoveryBin =
            dq.recoveryBin.collateral + sq.recoveryBin.collateral;
        const quoteRecoveryBin =
            db.recoveryBin.collateral + sb.recoveryBin.collateral;

        return {
            base: baseTicks,
            quote: quoteTicks,
            currentTick: {
                idx: curIdx,
                base: baseCurTickLiq,
                quote: quoteCurTickLiq,
            },
            recoveryBinCollateral: {
                base: baseRecoveryBin,
                quote: quoteRecoveryBin,
            },
            maxBase: maxBaseTickQty,
        };
    }

    /**
     * Creates a new `Pool`.
     * @param curTickIdx The initial tick index for the pool.
     */
    constructor(
        curTickIdx: number,
        args?: {
            baseQty: number;
            quoteQty: number;
            tickSpan: number;
        }
    ) {
        const baseTickIdx = new TickIndex(true, -curTickIdx);
        const quoteTickIdx = baseTickIdx.clone(true);

        if (args) {
            const baseHalf = args.baseQty / 2;
            const sbr = baseHalf * STABLE_AMM_CUT;
            const dbr = baseHalf - sbr;
            const sqi = sbr;
            const dqi = dbr;

            const quoteHalf = args.quoteQty / 2;
            const sqr = quoteHalf * STABLE_AMM_CUT;
            const dqr = quoteHalf - sqr;
            const sbi = sqr;
            const dbi = dqr;

            this.stableAMM = {
                base: new AMM(baseTickIdx.clone(), {
                    reserveQty: sbr,
                    inventoryQty: sbi,
                    tickSpan: args.tickSpan,
                }),
                quote: new AMM(quoteTickIdx.clone(), {
                    reserveQty: sqr,
                    inventoryQty: sqi,
                    tickSpan: args.tickSpan,
                }),
            };

            this.driftingAMM = {
                base: new AMM(baseTickIdx.clone(), {
                    reserveQty: dbr,
                    inventoryQty: dbi,
                    tickSpan: args.tickSpan,
                }),
                quote: new AMM(quoteTickIdx.clone(), {
                    reserveQty: dqr,
                    inventoryQty: dqi,
                    tickSpan: args.tickSpan,
                }),
            };
        } else {
            this.stableAMM = {
                base: new AMM(baseTickIdx.clone()),
                quote: new AMM(quoteTickIdx.clone()),
            };
            this.driftingAMM = {
                base: new AMM(baseTickIdx.clone()),
                quote: new AMM(quoteTickIdx.clone()),
            };
        }
    }
}

export type LiquidityDigestAbsolute = {
    base: OrderedMap<number, number>;
    quote: OrderedMap<number, number>;
    currentTick: {
        idx: number;
        base: number;
        quote: number;
    };
    recoveryBinCollateral: {
        base: number;
        quote: number;
    };
    maxBase: number;
};
