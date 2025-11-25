import { AMM } from "./amm.ts";
import { type AMMSwapDirection } from "./cur-tick.ts";
import { TickIndex } from "./ticks.ts";
import { panic, type TwoSided } from "./utils.ts";

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

    /**
     * Rebases the drifting AMMs to match the opposite side's inventory.
     * This should be called periodically by an external keeper.
     */
    public rebase() {
        const baseWorst = this.driftingAMM.base.getWorstInventoryTick();
        const quoteWorst = this.driftingAMM.quote.getWorstInventoryTick();

        // For base drifting AMM, left bound is opposite (quote) worst inventory tick
        // If no inventory, default to min()
        // Quote is Positive, Base is Negated. So we must Negate Quote index to get Base Target.
        const baseTarget = quoteWorst
            ? new TickIndex(false, -quoteWorst.idx.index())
            : this.driftingAMM.base.curTick().index().min();
        this.driftingAMM.base.rebase(baseTarget);

        // For quote drifting AMM, left bound is opposite (base) worst inventory tick
        // Base is Negated, Quote is Positive. So we must Negate Base index to get Quote Target.
        const quoteTarget = baseWorst
            ? new TickIndex(false, -baseWorst.idx.index())
            : this.driftingAMM.quote.curTick().index().min();
        this.driftingAMM.quote.rebase(quoteTarget);
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
        return this.calculateFees(il);
    }

    private calculateFees(il: number): number {
        return MIN_FEES + (il <= 0.9 ? (MAX_FEES * il) / 0.9 : MAX_FEES);
    }

    public getLiquidity(tickSpan: number): LiquidityAbsolute {
        const db = this.driftingAMM.base.getLiquidity(tickSpan);
        const dq = this.driftingAMM.quote.getLiquidity(tickSpan);
        const sb = this.stableAMM.base.getLiquidity(tickSpan);
        const sq = this.stableAMM.quote.getLiquidity(tickSpan);

        let maxBaseTickQty = 0,
            maxQuoteTickQty = 0;

        // combining all base ticks

        const allBaseTicks = [
            ...db.reserve,
            ...dq.inventory,
            ...sb.reserve,
            ...sq.inventory,
        ];
        if (dq.recoveryBin.worstTick) {
            allBaseTicks.push(dq.recoveryBin.worstTick);

            maxBaseTickQty = Math.max(
                maxBaseTickQty,
                dq.recoveryBin.worstTick.qty
            );
        }
        if (sq.recoveryBin.worstTick) {
            allBaseTicks.push(sq.recoveryBin.worstTick);

            maxBaseTickQty = Math.max(
                maxBaseTickQty,
                sq.recoveryBin.worstTick.qty
            );
        }

        const baseTicks: Map<number, number> = new Map();

        for (const tick of allBaseTicks) {
            const idx = tick.tickIdx.toAbsolute();

            const prev = baseTicks.get(idx) ?? 0;
            const qty = prev + tick.qty;
            baseTicks.set(idx, qty);

            maxBaseTickQty = Math.max(maxBaseTickQty, qty);
        }

        // combining all quote ticks

        const allQuoteTicks = [
            ...dq.reserve,
            ...db.inventory,
            ...sq.reserve,
            ...sb.inventory,
        ];
        if (db.recoveryBin.worstTick) {
            allQuoteTicks.push(db.recoveryBin.worstTick);

            maxQuoteTickQty = Math.max(
                maxQuoteTickQty,
                db.recoveryBin.worstTick.qty
            );
        }
        if (sb.recoveryBin.worstTick) {
            allQuoteTicks.push(sb.recoveryBin.worstTick);

            maxQuoteTickQty = Math.max(
                maxQuoteTickQty,
                sb.recoveryBin.worstTick.qty
            );
        }

        const quoteTicks: Map<number, number> = new Map();

        for (const tick of allQuoteTicks) {
            const idx = tick.tickIdx.toAbsolute();

            const prev = quoteTicks.get(idx) ?? 0;
            const qty = prev + tick.qty;
            quoteTicks.set(idx, qty);

            maxQuoteTickQty = Math.max(maxQuoteTickQty, qty);
        }

        // collect all liquidity from the current tick

        const baseCurTick =
            db.curTick.reserve +
            dq.curTick.inventory +
            sb.curTick.reserve +
            sq.curTick.inventory;

        maxBaseTickQty = Math.max(maxBaseTickQty, baseCurTick);

        const quoteCurTick =
            dq.curTick.reserve +
            db.curTick.inventory +
            sq.curTick.reserve +
            sb.curTick.inventory;

        maxQuoteTickQty = Math.max(maxQuoteTickQty, quoteCurTick);

        // collect all collateral

        const baseRecoveryBin =
            dq.recoveryBin.collateral + sq.recoveryBin.collateral;
        const quoteRecoveryBin =
            db.recoveryBin.collateral + sb.recoveryBin.collateral;

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

        return {
            base: baseTicks,
            quote: quoteTicks,
            currentTick: {
                idx: curIdx,
                base: baseCurTick,
                quote: quoteCurTick,
            },
            recoveryBinCollateral: {
                base: baseRecoveryBin,
                quote: quoteRecoveryBin,
            },
            maxBase: maxBaseTickQty,
            maxQuote: maxQuoteTickQty,
        };
    }

    /**
     * Executes a swap, takes fees upfront, and feeds the RecoveryBins of the
     * AMMs that are about to receive inventory (quote AMMs when buying quote,
     * base AMMs when buying base).
     */
    public swap(args: SwapArgs): SwapResult {
        const fees = args.qtyIn * this.getFees();
        const qtyIn = args.qtyIn - fees;

        const stableFees = fees * STABLE_AMM_CUT;
        const driftingFees = fees - stableFees;

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

        const oppositeSide = side === "base" ? "quote" : "base";
        const worstInventory =
            this.driftingAMM[oppositeSide].getWorstInventoryTick();
        const leftBound = worstInventory ? worstInventory.idx : undefined;

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

        while (qtyIn > 0) {
            let hasAny = false;

            // Keep swapping with each AMM until it's fully exhausted
            for (const [amm, direction] of amms) {
                while (qtyIn > 0) {
                    const { qtyOut: q, reminderIn } = amm.curTick().swap({
                        direction,
                        qtyIn,
                    });

                    if (reminderIn < qtyIn) {
                        hasAny = true;
                        qtyIn = reminderIn;
                        qtyOut += q;
                    } else {
                        // This AMM can't provide anything, move to next
                        break;
                    }
                }

                if (qtyIn === 0) return qtyOut;
            }

            // Check if we should move ticks
            // We can only move if ALL AMMs have exhausted the asset they PROVIDE
            if (!hasAny && qtyIn > 0) {
                // Verify AMMs are truly exhausted of what they provide
                let canMove = true;

                for (const [amm, dir] of amms) {
                    const curTick = amm.curTick();

                    // Check what asset this AMM PROVIDES (not consumes!)
                    if (dir === "reserve -> inventory") {
                        // Consumes reserve, PROVIDES inventory
                        if (curTick.hasInventory()) {
                            console.log(
                                `Cannot move: AMM (${dir}) still has inventory to provide`
                            );
                            canMove = false;
                            break;
                        }
                    } else {
                        // Consumes inventory, PROVIDES reserve
                        if (curTick.hasReserve()) {
                            console.log(
                                `Cannot move: AMM (${dir}) still has reserve to provide`
                            );
                            canMove = false;
                            break;
                        }
                    }
                }

                if (!canMove) {
                    // AMMs still have assets but swap() returned no progress
                    // This might be due to price limits or IL recovery
                    // For now, break to avoid infinite loop
                    console.log(
                        "Breaking: AMMs have assets but no progress made"
                    );
                    break;
                }

                // Move ALL AMMs together, passing their individual swap directions
                // Move ALL AMMs together, passing their individual swap directions
                if (direction === "base -> quote") {
                    // Price Down
                    baseDirection = "reserve -> inventory";
                    quoteDirection = "inventory -> reserve";

                    this.stableAMM.base.curTick().increment(baseDirection);
                    this.stableAMM.quote.curTick().decrement(quoteDirection);

                    this.driftingAMM.base.curTick().increment(baseDirection);
                    this.driftingAMM.quote.curTick().decrement(quoteDirection);
                } else {
                    // Price Up
                    baseDirection = "inventory -> reserve";
                    quoteDirection = "reserve -> inventory";

                    this.stableAMM.base.curTick().decrement(baseDirection);
                    this.stableAMM.quote.curTick().increment(quoteDirection);

                    this.driftingAMM.base.curTick().decrement(baseDirection);
                    this.driftingAMM.quote.curTick().increment(quoteDirection);
                }

                const indices = amms.map(([it, _]) =>
                    Math.abs(it.curTick().index().index())
                );
                const allSame = indices.every((idx) => idx === indices[0]);
                if (!allSame) {
                    panic(
                        `After tick move some ticks are different, while should be the same! ${indices}`
                    );
                }
            } else if (!hasAny) {
                // No progress and no qty left - swap complete (shouldn't happen)
                break;
            }
        }

        return qtyOut;
    }

    /**
     * Creates a new `Pool`.
     * @param curTickIdx The initial tick index for the pool.
     */
    constructor(curTickIdx: number) {
        // Base is Inverted (Relative = -Absolute)
        const baseTickIdx = new TickIndex(true, -curTickIdx);
        // Quote is Normal (Relative = Absolute)
        const quoteTickIdx = new TickIndex(false, curTickIdx);

        this.stableAMM = {
            base: new AMM(baseTickIdx),
            quote: new AMM(quoteTickIdx),
        };

        this.driftingAMM = {
            base: new AMM(baseTickIdx),
            quote: new AMM(quoteTickIdx),
        };
    }
}

export type LiquidityAbsolute = {
    base: Map<number, number>;
    quote: Map<number, number>;
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
    maxQuote: number;
};
