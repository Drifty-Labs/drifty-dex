import { AMM } from "./amm.ts";
import { type AMMSwapDirection } from "./cur-tick.ts";
import { InventoryRange, ReserveRange } from "./range.ts";
import {
    almostEq,
    panic,
    type TwoSided,
    absoluteTickToPrice,
    type SwapDirection,
    BASE_PRICE,
} from "./utils.ts";

const STABLE_AMM_CUT = 0.05;
const MIN_FEES = 0.0001;
const MAX_FEES = 0.1;

export type SwapArgs = {
    qtyIn: number;
    direction: SwapDirection;
};

export type SwapResult = {
    qtyOut: number;
    feeFactor: number;
    feesIn: number;
    slippage: number;
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
        private noLogs: boolean,
        args?: {
            baseQty: number;
            quoteQty: number;
        }
    ) {
        if (args) {
            const stableBaseShare = args.baseQty * STABLE_AMM_CUT;
            const stableQuoteShare = args.quoteQty * STABLE_AMM_CUT;

            this.stableAMM = {
                base: new AMM("base", false, noLogs, curTickIdx),
                quote: new AMM("quote", false, noLogs, curTickIdx),
            };

            this.stableAMM.base.deposit({
                reserve: stableBaseShare,
                accountDepositedReserve: true,
            });
            this.stableAMM.quote.deposit({
                reserve: stableQuoteShare,
                accountDepositedReserve: true,
            });

            const driftingBaseShare = args.baseQty - stableBaseShare;
            const driftingQuoteShare = args.quoteQty - stableQuoteShare;

            const dbr = driftingBaseShare / 2;
            const dqi = driftingBaseShare - dbr;

            const dqr = driftingQuoteShare / 2;
            const dbi = driftingQuoteShare - dqr;

            this.driftingAMM = {
                base: new AMM("base", true, noLogs, curTickIdx, {
                    reserveQty: dbr,
                    inventoryQty: dbi,
                    tickSpan: tickSpan,
                }),
                quote: new AMM("quote", true, noLogs, curTickIdx, {
                    reserveQty: dqr,
                    inventoryQty: dqi,
                    tickSpan: tickSpan,
                }),
            };
        } else {
            this.stableAMM = {
                base: new AMM("base", false, noLogs, curTickIdx),
                quote: new AMM("quote", false, noLogs, curTickIdx),
            };
            this.driftingAMM = {
                base: new AMM("base", true, noLogs, curTickIdx),
                quote: new AMM("quote", true, noLogs, curTickIdx),
            };
        }
    }

    public clone(noLogs: boolean) {
        const p = new Pool(
            this.driftingAMM.quote.currentTick.index,
            this.tickSpan,
            noLogs
        );

        p.stableAMM.base = this.stableAMM.base.clone(noLogs);
        p.stableAMM.quote = this.stableAMM.quote.clone(noLogs);

        p.driftingAMM.base = this.driftingAMM.base.clone(noLogs);
        p.driftingAMM.quote = this.driftingAMM.quote.clone(noLogs);

        return p;
    }

    // TODO: forbid drifting closer than tickSpan
    // TODO: instead of syntetic initial deposit, make a regular deposit

    private drift() {
        const baseWorst = this.driftingAMM.base.worstInventoryTick;

        if (baseWorst !== undefined) {
            this.driftingAMM.quote.drift(baseWorst.idx, this.tickSpan);
        }

        const quoteWorst = this.driftingAMM.quote.worstInventoryTick;

        if (quoteWorst !== undefined) {
            this.driftingAMM.base.drift(quoteWorst.idx, this.tickSpan);
        }
    }

    public swap(args: SwapArgs): SwapResult {
        const feeFactor = this.feeFactor;
        const fees = args.qtyIn * feeFactor;
        const qtyIn = args.qtyIn - fees;

        const stableFees = fees * STABLE_AMM_CUT;
        const driftingFees = fees - stableFees;

        let expectedOut: number = 0;
        let qtyOut: number = 0;

        const tickBefore = this.curAbsoluteTick;

        if (args.direction === "base -> quote") {
            this.stableAMM["quote"].currentTick.addInventoryFees(stableFees);
            this.driftingAMM["quote"].currentTick.addInventoryFees(
                driftingFees
            );

            expectedOut =
                qtyIn *
                absoluteTickToPrice(this.curAbsoluteTick, "base", "reserve");
            qtyOut = this._swap(qtyIn, args.direction);
        } else {
            this.stableAMM["base"].currentTick.addInventoryFees(stableFees);
            this.driftingAMM["base"].currentTick.addInventoryFees(driftingFees);

            expectedOut =
                qtyIn *
                absoluteTickToPrice(this.curAbsoluteTick, "quote", "reserve");
            qtyOut = this._swap(qtyIn, args.direction);
        }

        this.drift();

        const tickAfter = this.curAbsoluteTick;

        const priceChange = Math.pow(
            BASE_PRICE,
            Math.abs(tickBefore - tickAfter)
        );

        const slippage = 1 - qtyOut / expectedOut;

        if (!this.noLogs) {
            console.log(
                args.direction,
                "Expected:",
                expectedOut,
                "Actual:",
                qtyOut
            );
            console.log(
                `Slippage: ${(slippage * 100).toFixed(
                    2
                )}%, price change: ${tickBefore} -> ${tickAfter} (${(
                    (priceChange - 1) *
                    100
                ).toFixed(2)}%)`
            );
        }

        return { qtyOut, feeFactor, feesIn: fees, slippage };
    }

    public deposit(side: keyof TwoSided<AMM>, qty: number) {
        const stableCut = qty * STABLE_AMM_CUT;
        const driftingCut = qty - stableCut;

        this.stableAMM[side].deposit({
            reserve: stableCut,
            accountDepositedReserve: true,
        });

        this.driftingAMM[side].deposit({
            reserve: driftingCut,
            tickSpan: this.tickSpan,
            accountDepositedReserve: true,
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
                } = amm[0].currentTick.swap({
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
                for (const amm of amms) {
                    if (amm[2] > 0) {
                        amm[0].deposit({
                            reserve: amm[2],
                            tickSpan: this.tickSpan,
                            accountDepositedReserve: false,
                        });
                        amm[2] = 0;
                    }
                }

                return qtyOut;
            }

            // Check if we should move ticks
            // We can only move if ALL AMMs have exhausted the asset they PROVIDE
            if (!hasAny && !almostEq(qtyIn, 0)) {
                // Move ALL AMMs together
                if (direction === "base -> quote") {
                    this.stableAMM.base.currentTick.nextInventoryTick();
                    this.driftingAMM.base.currentTick.nextInventoryTick();

                    this.stableAMM.quote.currentTick.nextReserveTick();
                    this.driftingAMM.quote.currentTick.nextReserveTick();
                } else {
                    this.stableAMM.base.currentTick.nextReserveTick();
                    this.driftingAMM.base.currentTick.nextReserveTick();

                    this.stableAMM.quote.currentTick.nextInventoryTick();
                    this.driftingAMM.quote.currentTick.nextInventoryTick();
                }
            } else if (!hasAny) {
                panic("No progress and no qty left - swap complete");
            }
        }

        return qtyOut;
    }

    public get curAbsoluteTick(): number {
        return this.driftingAMM.base.currentTick.index;
    }

    public get depositedReserves(): TwoSided<number> {
        return {
            base: this.driftingAMM.base.depositedReserve,
            quote: this.driftingAMM.quote.depositedReserve,
        };
    }

    public get il(): TwoSided<number> {
        return {
            base:
                this.stableAMM.base.il * STABLE_AMM_CUT +
                this.driftingAMM.base.il * (1 - STABLE_AMM_CUT),
            quote:
                this.stableAMM.quote.il * STABLE_AMM_CUT +
                this.driftingAMM.quote.il * (1 - STABLE_AMM_CUT),
        };
    }

    public get driftingReserveWidth(): TwoSided<number> {
        const baseReserve = this.driftingAMM.base["_liquidity"].reserve;
        const baseWidth = baseReserve.isInitted() ? baseReserve.width : 0;

        const quoteReserve = this.driftingAMM.quote["_liquidity"].reserve;
        const quoteWidth = quoteReserve.isInitted() ? quoteReserve.width : 0;

        return {
            base:
                baseWidth > 0
                    ? Math.pow(BASE_PRICE, baseWidth) / BASE_PRICE - 1
                    : 0,
            quote:
                quoteWidth > 0
                    ? Math.pow(BASE_PRICE, quoteWidth) / BASE_PRICE - 1
                    : 0,
        };
    }

    public get feeFactor(): number {
        const { base: bf, quote: qf } = this.il;
        const { base: bw, quote: qw } = this.driftingReserveWidth;

        return this.calculateFees((bf + qf) / 2, (bw + qw) / 2);
    }

    private calculateFees(il: number, width: number): number {
        const ilFees =
            MIN_FEES + (il <= 0.9 ? (MAX_FEES * il) / 0.9 : MAX_FEES);
        const widthFees = MIN_FEES + Math.min(width, 1) * MAX_FEES;

        return (ilFees + widthFees) / 2;
    }

    public get liquidityDigest(): LiquidityDigestAbsolute {
        const db = this.driftingAMM.base.liquidityDigest;
        const dq = this.driftingAMM.quote.liquidityDigest;
        const sb = this.stableAMM.base.liquidityDigest;
        const sq = this.stableAMM.quote.liquidityDigest;

        // collect and verify current tick idx invariant

        const curIdx = db.curTick.idx;
        if (
            db.curTick.idx !== curIdx ||
            dq.curTick.idx !== curIdx ||
            sb.curTick.idx !== curIdx ||
            sq.curTick.idx !== curIdx
        ) {
            panic(
                `Ticks don't match: drifting-base=${db.curTick.idx}, drifting-quote=${dq.curTick.idx}, stable-base=${sb.curTick.idx}, stable-quote=${sq.curTick.idx}`
            );
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

    public get stats(): TwoSided<Stats> {
        const actualBaseInv =
            this.driftingAMM.base.actualInventory +
            this.stableAMM.base.actualInventory;

        const base: Stats = {
            depositedReserve:
                this.driftingAMM.base.depositedReserve +
                this.stableAMM.base.depositedReserve,
            actualReserve:
                this.driftingAMM.base.actualReserve +
                this.stableAMM.base.actualReserve,
            actualInventory: actualBaseInv,
            respectiveReserve:
                this.driftingAMM.base.respectiveReserve +
                this.stableAMM.base.respectiveReserve,
            expectedReserveFromExit:
                actualBaseInv *
                absoluteTickToPrice(this.curAbsoluteTick, "base", "inventory"),
        };

        const actualQuoteInv =
            this.driftingAMM.quote.actualInventory +
            this.stableAMM.quote.actualInventory;

        const quote: Stats = {
            depositedReserve:
                this.driftingAMM.quote.depositedReserve +
                this.stableAMM.quote.depositedReserve,
            actualReserve:
                this.driftingAMM.quote.actualReserve +
                this.stableAMM.quote.actualReserve,
            actualInventory: actualQuoteInv,
            respectiveReserve:
                this.driftingAMM.quote.respectiveReserve +
                this.stableAMM.quote.respectiveReserve,
            expectedReserveFromExit:
                actualQuoteInv *
                absoluteTickToPrice(this.curAbsoluteTick, "quote", "inventory"),
        };

        return { base, quote };
    }
}

export type Stats = {
    depositedReserve: number;
    actualReserve: number;
    actualInventory: number;
    respectiveReserve: number;
    expectedReserveFromExit: number;
};

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
