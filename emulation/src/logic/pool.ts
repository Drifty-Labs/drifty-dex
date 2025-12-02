import { AMM } from "./amm.ts";
import { type AMMSwapDirection } from "./cur-tick.ts";
import { InventoryRange, ReserveRange } from "./range.ts";
import { almostEq, panic, type TwoSided, type Side } from "./utils.ts";

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

export class Pool {
    private stableAMM: TwoSided<AMM>;
    private driftingAMM: TwoSided<AMM>;

    /**
     * Creates a new `Pool`.
     * @param curTickIdx The initial tick index for the pool.
     */
    constructor(
        curTickIdx: number,
        private tickSpan: number,
        args?: {
            baseQty: number;
            quoteQty: number;
        }
    ) {
        if (args) {
            const stableBaseShare = args.baseQty * STABLE_AMM_CUT;
            const stableQuoteShare = args.quoteQty * STABLE_AMM_CUT;

            this.stableAMM = {
                base: new AMM("base", curTickIdx),
                quote: new AMM("quote", curTickIdx),
            };

            this.stableAMM.base.deposit({ reserve: stableBaseShare });
            this.stableAMM.quote.deposit({ reserve: stableQuoteShare });

            const driftingBaseShare = args.baseQty - stableBaseShare;
            const driftingQuoteShare = args.quoteQty - stableQuoteShare;

            const dbr = driftingBaseShare / 2;
            const dqi = driftingBaseShare - dbr;

            const dqr = driftingQuoteShare / 2;
            const dbi = driftingQuoteShare - dqr;

            this.driftingAMM = {
                base: new AMM("base", curTickIdx, {
                    reserveQty: dbr,
                    inventoryQty: dbi,
                    tickSpan: tickSpan,
                }),
                quote: new AMM("quote", curTickIdx, {
                    reserveQty: dqr,
                    inventoryQty: dqi,
                    tickSpan: tickSpan,
                }),
            };
        } else {
            this.stableAMM = {
                base: new AMM("base", curTickIdx),
                quote: new AMM("quote", curTickIdx),
            };
            this.driftingAMM = {
                base: new AMM("base", curTickIdx),
                quote: new AMM("quote", curTickIdx),
            };
        }
    }

    public clone() {
        const p = new Pool(this.driftingAMM.quote.curTick.index, this.tickSpan);

        p.stableAMM.base = this.stableAMM.base.clone();
        p.stableAMM.quote = this.stableAMM.quote.clone();

        p.driftingAMM.base = this.driftingAMM.base.clone();
        p.driftingAMM.quote = this.driftingAMM.quote.clone();

        return p;
    }

    private drift() {
        const baseWorst = this.driftingAMM.base.getRightInventoryTick();

        if (baseWorst !== undefined) {
            this.driftingAMM.quote.drift(baseWorst.idx);
        }

        const quoteWorst = this.driftingAMM.quote.getRightInventoryTick();

        if (quoteWorst !== undefined) {
            this.driftingAMM.base.drift(quoteWorst.idx);
        }
    }

    public swap(args: SwapArgs): SwapResult {
        const feeFactor = this.getFees();
        const fees = args.qtyIn * feeFactor;
        const qtyIn = args.qtyIn - fees;

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

        this.drift();

        return { qtyOut };
    }

    public deposit(side: keyof TwoSided<AMM>, qty: number) {
        const stableCut = qty * STABLE_AMM_CUT;
        const driftingCut = qty - stableCut;

        this.stableAMM[side].deposit({ reserve: stableCut });

        this.driftingAMM[side].deposit({
            reserve: driftingCut,
            tickSpan: this.tickSpan,
        });
    }

    public withdraw(side: keyof TwoSided<AMM>, qty: number) {
        const stableCut = qty * STABLE_AMM_CUT;
        const driftingCut = qty - stableCut;

        this.stableAMM[side].withdraw({ depositedReserve: stableCut });
        this.driftingAMM[side].withdraw({ depositedReserve: driftingCut });
    }

    private _swap(qtyIn: number, direction: SwapDirection): number {
        let qtyOut = 0;

        let baseDirection: AMMSwapDirection;
        let quoteDirection: AMMSwapDirection;

        if (direction === "base -> quote") {
            baseDirection = "reserve -> inventory";
            quoteDirection = "inventory -> reserve";
        } else {
            baseDirection = "inventory -> reserve";
            quoteDirection = "reserve -> inventory";
        }

        const amms: [AMM, AMMSwapDirection, number][] = [
            [this.stableAMM.base, baseDirection, 0],
            [this.driftingAMM.base, baseDirection, 0],
            [this.stableAMM.quote, quoteDirection, 0],
            [this.driftingAMM.quote, quoteDirection, 0],
        ];

        while (!almostEq(qtyIn, 0)) {
            let hasAny = false;

            // Keep swapping with each AMM until it's fully exhausted
            for (const amm of amms) {
                const {
                    qtyOut: q,
                    reminderIn,
                    recoveredReserve,
                } = amm[0].curTick.swap({
                    direction: amm[1],
                    qtyIn,
                });

                if (recoveredReserve > 0) {
                    amm[2] += recoveredReserve;
                }

                if (reminderIn < qtyIn) {
                    hasAny = true;
                    qtyIn = reminderIn;
                    qtyOut += q;
                }

                if (almostEq(qtyIn, 0)) break;
            }

            if (almostEq(qtyIn, 0)) {
                for (const [amm, _, recoveredReserve] of amms) {
                    if (recoveredReserve > 0) {
                        amm.deposit({
                            reserve: recoveredReserve,
                            tickSpan: this.tickSpan,
                        });
                    }
                }

                return qtyOut;
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
            } else if (!hasAny) {
                panic("No progress and no qty left - swap complete");
            }
        }

        return qtyOut;
    }

    public getCurAbsoluteTick(): number {
        return this.driftingAMM.base.curTick.index;
    }

    public getDepositedReserves(): TwoSided<number> {
        return {
            base: this.driftingAMM.base.getDepositedReserve(),
            quote: this.driftingAMM.quote.getDepositedReserve(),
        };
    }

    public getAvgImpermanentLoss(): number {
        // TODO: IL is calculated on a false assumption that if we sell the inventory right now we get less reserve
        // TODO: double check that, this might be an issue with the price and stuff

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

    public getFees(): number {
        const il = this.getAvgImpermanentLoss();
        return this.calculateFees(il);
    }

    private calculateFees(il: number): number {
        return MIN_FEES + (il <= 0.9 ? (MAX_FEES * il) / 0.9 : MAX_FEES);
    }

    public getLiquidityDigest(): LiquidityDigestAbsolute {
        const db = this.driftingAMM.base.getLiquidityDigest();
        const dq = this.driftingAMM.quote.getLiquidityDigest();
        const sb = this.stableAMM.base.getLiquidityDigest();
        const sq = this.stableAMM.quote.getLiquidityDigest();

        // collect and verify current tick idx invariant

        const curIdx = db.curTick.idx;
        if (
            db.curTick.idx !== curIdx ||
            dq.curTick.idx !== curIdx ||
            sb.curTick.idx !== curIdx ||
            sq.curTick.idx !== curIdx
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
            base: {
                reserve: db.reserve,
                inventory: db.inventory,
            },
            quote: {
                reserve: dq.reserve,
                inventory: dq.inventory,
            },
            currentTick: {
                idx: curIdx,
                base: baseCurTickLiq,
                quote: quoteCurTickLiq,
            },
            recoveryBinCollateral: {
                base: baseRecoveryBin,
                quote: quoteRecoveryBin,
            },
        };
    }

    public getStats(): TwoSided<{
        depositedReserve: number;
        actualReserve: number;
        actualInventory: number;
        respectiveReserve: number;
    }> {
        const base = {
            depositedReserve:
                this.driftingAMM.base.getDepositedReserve() +
                this.stableAMM.base.getDepositedReserve(),
            actualReserve:
                this.driftingAMM.base.getActualReserve() +
                this.stableAMM.base.getActualReserve(),
            actualInventory:
                this.driftingAMM.base.getActualInventory() +
                this.stableAMM.base.getActualInventory(),
            respectiveReserve:
                this.driftingAMM.base.getRespectiveReserve() +
                this.stableAMM.base.getRespectiveReserve(),
        };

        const quote = {
            depositedReserve:
                this.driftingAMM.quote.getDepositedReserve() +
                this.stableAMM.quote.getDepositedReserve(),
            actualReserve:
                this.driftingAMM.quote.getActualReserve() +
                this.stableAMM.quote.getActualReserve(),
            actualInventory:
                this.driftingAMM.quote.getActualInventory() +
                this.stableAMM.quote.getActualInventory(),
            respectiveReserve:
                this.driftingAMM.quote.getRespectiveReserve() +
                this.stableAMM.quote.getRespectiveReserve(),
        };

        return { base, quote };
    }
}

export type LiquidityDigestAbsolute = {
    base: {
        reserve?: ReserveRange;
        inventory: InventoryRange[];
    };
    quote: {
        reserve?: ReserveRange;
        inventory: InventoryRange[];
    };
    currentTick: {
        idx: number;
        base: number;
        quote: number;
    };
    recoveryBinCollateral: {
        base: number;
        quote: number;
    };
};
