import { AMM } from "./amm.ts";
import { type AMMSwapDirection } from "./cur-tick.ts";
import { E8s } from "./ecs.ts";
import { InventoryRange, ReserveRange } from "./range.ts";
import {
    panic,
    type TwoSided,
    absoluteTickToPrice,
    type SwapDirection,
    BASE_PRICE,
} from "./utils.ts";

const STABLE_AMM_CUT = new E8s(500_0000n);
const MIN_FEES = new E8s(1_0000n);
const MAX_FEES = new E8s(1000_0000n);

export type SwapArgs = {
    qtyIn: E8s;
    direction: SwapDirection;
};

export type SwapResult = {
    qtyOut: E8s;
    feeFactor: E8s;
    feesIn: E8s;
    slippage: E8s;
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
            baseQty: E8s;
            quoteQty: E8s;
        }
    ) {
        if (args) {
            const stableBaseShare = args.baseQty.mul(STABLE_AMM_CUT);
            const stableQuoteShare = args.quoteQty.mul(STABLE_AMM_CUT);

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

            const driftingBaseShare = args.baseQty.sub(stableBaseShare);
            const driftingQuoteShare = args.quoteQty.sub(stableQuoteShare);

            const dbr = driftingBaseShare.div(2);
            const dqi = driftingBaseShare.sub(dbr);

            const dqr = driftingQuoteShare.div(2);
            const dbi = driftingQuoteShare.sub(dqr);

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
        const fees = args.qtyIn.mul(feeFactor);
        const qtyIn = args.qtyIn.sub(fees);

        const stableFees = fees.mul(STABLE_AMM_CUT);
        const driftingFees = fees.sub(stableFees);

        let expectedOut = E8s.zero();
        let qtyOut = E8s.zero();

        const tickBefore = this.curAbsoluteTick;

        if (args.direction === "base -> quote") {
            this.stableAMM["quote"].currentTick.addInventoryFees(stableFees);
            this.driftingAMM["quote"].currentTick.addInventoryFees(
                driftingFees
            );

            expectedOut = qtyIn.mul(
                absoluteTickToPrice(this.curAbsoluteTick, "base", "reserve")
            );
            qtyOut = this._swap(qtyIn, args.direction);
        } else {
            this.stableAMM["base"].currentTick.addInventoryFees(stableFees);
            this.driftingAMM["base"].currentTick.addInventoryFees(driftingFees);

            expectedOut = qtyIn.mul(
                absoluteTickToPrice(this.curAbsoluteTick, "quote", "reserve")
            );
            qtyOut = this._swap(qtyIn, args.direction);
        }

        this.drift();

        const tickAfter = this.curAbsoluteTick;

        const priceChange = BASE_PRICE.pow(Math.abs(tickBefore - tickAfter));

        const slippage = E8s.one().sub(qtyOut.div(expectedOut));

        if (!this.noLogs) {
            console.log(
                args.direction,
                "Expected:",
                expectedOut,
                "Actual:",
                qtyOut
            );
            console.log(
                `Slippage: ${slippage
                    .mul(100)
                    .toString(
                        2
                    )}%, price change: ${tickBefore} -> ${tickAfter} (${priceChange
                    .sub(E8s.one())
                    .mul(100)
                    .toString(2)}%)`
            );
        }

        return { qtyOut, feeFactor, feesIn: fees, slippage };
    }

    public deposit(side: keyof TwoSided<AMM>, qty: E8s) {
        const stableCut = qty.mul(STABLE_AMM_CUT);
        const driftingCut = qty.sub(stableCut);

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

    public withdraw(side: keyof TwoSided<AMM>, qty: E8s) {
        const stableCut = qty.mul(STABLE_AMM_CUT);
        const driftingCut = qty.sub(stableCut);

        this.stableAMM[side].withdraw({ depositedReserve: stableCut });
        this.driftingAMM[side].withdraw({ depositedReserve: driftingCut });
    }

    private _swap(qtyIn: E8s, direction: SwapDirection): E8s {
        let qtyOut = E8s.zero();

        let baseDirection: AMMSwapDirection;
        let quoteDirection: AMMSwapDirection;

        if (direction === "base -> quote") {
            baseDirection = "reserve -> inventory";
            quoteDirection = "inventory -> reserve";
        } else {
            baseDirection = "inventory -> reserve";
            quoteDirection = "reserve -> inventory";
        }

        const amms: [AMM, AMMSwapDirection, E8s][] = [
            [this.stableAMM.base, baseDirection, E8s.zero()],
            [this.driftingAMM.base, baseDirection, E8s.zero()],
            [this.stableAMM.quote, quoteDirection, E8s.zero()],
            [this.driftingAMM.quote, quoteDirection, E8s.zero()],
        ];

        while (!qtyIn.isZero()) {
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

                if (recoveredReserve.isPositive()) {
                    amm[2].addAssign(recoveredReserve);
                }

                if (reminderIn.lt(qtyIn)) {
                    hasAny = true;
                    qtyIn = reminderIn;
                    qtyOut.addAssign(q);
                }

                if (qtyIn.isZero()) break;
            }

            if (qtyIn.isZero()) {
                for (const amm of amms) {
                    if (amm[2].isPositive()) {
                        amm[0].deposit({
                            reserve: amm[2].clone(),
                            tickSpan: this.tickSpan,
                            accountDepositedReserve: false,
                        });
                        amm[2] = E8s.zero();
                    }
                }

                return qtyOut;
            }

            // Check if we should move ticks
            // We can only move if ALL AMMs have exhausted the asset they PROVIDE
            if (!hasAny && !qtyIn.isZero()) {
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

    public get depositedReserves(): TwoSided<E8s> {
        return {
            base: this.driftingAMM.base.depositedReserve,
            quote: this.driftingAMM.quote.depositedReserve,
        };
    }

    public get il(): TwoSided<E8s> {
        return {
            base: this.stableAMM.base.il
                .mul(STABLE_AMM_CUT)
                .add(
                    this.driftingAMM.base.il.mul(E8s.one().sub(STABLE_AMM_CUT))
                ),
            quote: this.stableAMM.quote.il
                .mul(STABLE_AMM_CUT)
                .add(
                    this.driftingAMM.quote.il.mul(E8s.one().sub(STABLE_AMM_CUT))
                ),
        };
    }

    public get driftingReserveWidth(): TwoSided<E8s> {
        const baseReserve = this.driftingAMM.base["_liquidity"].reserve;
        const baseWidth = baseReserve.isInitted() ? baseReserve.width : 0;

        const quoteReserve = this.driftingAMM.quote["_liquidity"].reserve;
        const quoteWidth = quoteReserve.isInitted() ? quoteReserve.width : 0;

        return {
            base:
                baseWidth > 0
                    ? BASE_PRICE.pow(baseWidth).div(BASE_PRICE).sub(E8s.one())
                    : E8s.zero(),
            quote:
                quoteWidth > 0
                    ? BASE_PRICE.pow(quoteWidth).div(BASE_PRICE).sub(E8s.one())
                    : E8s.zero(),
        };
    }

    public get feeFactor(): E8s {
        const { base: bf, quote: qf } = this.il;
        const { base: bw, quote: qw } = this.driftingReserveWidth;

        return this.calculateFees(bf.add(qf).div(2), bw.add(qw).div(2));
    }

    private calculateFees(il: E8s, width: E8s): E8s {
        const ilFees = MIN_FEES.add(
            il.le(E8s.half())
                ? MAX_FEES.mul(il).div(E8s.half())
                : MAX_FEES.clone()
        );

        const widthFees = MIN_FEES.add(
            MAX_FEES.mul(width.gt(E8s.one()) ? E8s.one() : width)
        );

        return ilFees.add(widthFees).div(2);
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

        const baseCurTickLiq = db.curTick.reserve
            .add(dq.curTick.inventory)
            .add(sb.curTick.reserve)
            .add(sq.curTick.inventory);

        const quoteCurTickLiq = dq.curTick.reserve
            .add(db.curTick.inventory)
            .add(sq.curTick.reserve)
            .add(sb.curTick.inventory);

        // collect all collateral

        const baseRecoveryBin = dq.recoveryBin.collateral.add(
            sq.recoveryBin.collateral
        );
        const quoteRecoveryBin = db.recoveryBin.collateral.add(
            sb.recoveryBin.collateral
        );

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
        const actualBaseInv = this.driftingAMM.base.actualInventory.add(
            this.stableAMM.base.actualInventory
        );

        const base: Stats = {
            depositedReserve: this.driftingAMM.base.depositedReserve.add(
                this.stableAMM.base.depositedReserve
            ),
            actualReserve: this.driftingAMM.base.actualReserve.add(
                this.stableAMM.base.actualReserve
            ),
            actualInventory: actualBaseInv,
            respectiveReserve: this.driftingAMM.base.respectiveReserve.add(
                this.stableAMM.base.respectiveReserve
            ),
            expectedReserveFromExit: actualBaseInv.mul(
                absoluteTickToPrice(this.curAbsoluteTick, "base", "inventory")
            ),
        };

        const actualQuoteInv = this.driftingAMM.quote.actualInventory.add(
            this.stableAMM.quote.actualInventory
        );

        const quote: Stats = {
            depositedReserve: this.driftingAMM.quote.depositedReserve.add(
                this.stableAMM.quote.depositedReserve
            ),
            actualReserve: this.driftingAMM.quote.actualReserve.add(
                this.stableAMM.quote.actualReserve
            ),
            actualInventory: actualQuoteInv,
            respectiveReserve: this.driftingAMM.quote.respectiveReserve.add(
                this.stableAMM.quote.respectiveReserve
            ),
            expectedReserveFromExit: actualQuoteInv.mul(
                absoluteTickToPrice(this.curAbsoluteTick, "quote", "inventory")
            ),
        };

        return { base, quote };
    }
}

export type Stats = {
    depositedReserve: E8s;
    actualReserve: E8s;
    actualInventory: E8s;
    respectiveReserve: E8s;
    expectedReserveFromExit: E8s;
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
        base: E8s;
        quote: E8s;
    };
    recoveryBinCollateral: {
        base: E8s;
        quote: E8s;
    };
};
