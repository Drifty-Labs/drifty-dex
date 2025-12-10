import { AMM } from "./amm.ts";
import { Beacon } from "./beacon.ts";
import { absoluteTickToPrice, BASE_PRICE, ECs } from "./ecs.ts";
import {
    panic,
    type TwoSided,
    type SwapDirection,
    type AMMSwapDirection,
} from "./utils.ts";
import { Range } from "./range.ts";
import { POOL } from "../components/Simulation.tsx";

const STABLE_AMM_CUT = ECs.fromString("0.05");
const MIN_FEES = ECs.fromString("0.0001");
const MAX_FEES = ECs.fromString("0.1");

export type SwapArgs = {
    qtyIn: ECs;
    direction: SwapDirection;
};

export type SwapResult = {
    qtyOut: ECs;
    feeFactor: ECs;
    feesIn: ECs;
    slippage: ECs;
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
            baseQty: ECs;
            quoteQty: ECs;
        }
    ) {
        if (args) {
            const stableBaseShare = args.baseQty.mul(STABLE_AMM_CUT);
            const stableQuoteShare = args.quoteQty.mul(STABLE_AMM_CUT);

            this.stableAMM = {
                base: new AMM(
                    Beacon.base(this, "stable"),
                    undefined,
                    curTickIdx
                ),
                quote: new AMM(
                    Beacon.quote(this, "stable"),
                    undefined,
                    curTickIdx
                ),
            };

            this.stableAMM.base.deposit({
                reserve: stableBaseShare,
            });
            this.stableAMM.quote.deposit({
                reserve: stableQuoteShare,
            });

            const driftingBaseShare = args.baseQty.sub(stableBaseShare);
            const driftingQuoteShare = args.quoteQty.sub(stableQuoteShare);

            const getTickSpan = () => this.tickSpan;

            this.driftingAMM = {
                base: new AMM(
                    Beacon.base(this, "drifting"),
                    getTickSpan,
                    curTickIdx
                ),
                quote: new AMM(
                    Beacon.quote(this, "drifting"),
                    getTickSpan,
                    curTickIdx
                ),
            };

            this.driftingAMM.base.deposit({ reserve: driftingBaseShare });
            this.driftingAMM.quote.deposit({ reserve: driftingQuoteShare });
        } else {
            this.stableAMM = {
                base: new AMM(
                    Beacon.base(this, "stable"),
                    undefined,
                    curTickIdx
                ),
                quote: new AMM(
                    Beacon.quote(this, "stable"),
                    undefined,
                    curTickIdx
                ),
            };

            const getTickSpan = () => this.tickSpan;

            this.driftingAMM = {
                base: new AMM(
                    Beacon.base(this, "drifting"),
                    getTickSpan,
                    curTickIdx
                ),
                quote: new AMM(
                    Beacon.quote(this, "drifting"),
                    getTickSpan,
                    curTickIdx
                ),
            };
        }
    }

    public clone(noLogs?: boolean) {
        noLogs = noLogs ?? this.noLogs;

        const p = new Pool(
            this.driftingAMM.quote.currentTick.getIndex(),
            this.tickSpan,
            noLogs
        );

        const getTickSpan = () => p.tickSpan;

        p.stableAMM.base = this.stableAMM.base.clone(p, noLogs, undefined);
        p.stableAMM.quote = this.stableAMM.quote.clone(p, noLogs, undefined);

        p.driftingAMM.base = this.driftingAMM.base.clone(
            p,
            noLogs,
            getTickSpan
        );
        p.driftingAMM.quote = this.driftingAMM.quote.clone(
            p,
            noLogs,
            getTickSpan
        );

        return p;
    }

    private drift() {
        const baseInventoryWorst =
            this.driftingAMM.base.liquidity.getWorstInventory();

        if (baseInventoryWorst !== undefined) {
            this.driftingAMM.quote.liquidity.driftReserveWorst(
                baseInventoryWorst
            );
        }

        const quoteInventoryWorst =
            this.driftingAMM.quote.liquidity.getWorstInventory();

        if (quoteInventoryWorst !== undefined) {
            this.driftingAMM.base.liquidity.driftReserveWorst(
                quoteInventoryWorst
            );
        }
    }

    public swap(args: SwapArgs): SwapResult {
        const feeFactor = this.feeFactor;
        const fees = args.qtyIn.mul(feeFactor);
        const qtyIn = args.qtyIn.sub(fees);

        const stableFees = fees.mul(STABLE_AMM_CUT);
        const driftingFees = fees.sub(stableFees);

        let expectedOut = ECs.zero();
        let qtyOut = ECs.zero();

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

        const slippage = ECs.one().sub(qtyOut.div(expectedOut));

        return { qtyOut, feeFactor, feesIn: fees, slippage };
    }

    public deposit(side: keyof TwoSided<AMM>, qty: ECs) {
        const stableCut = qty.mul(STABLE_AMM_CUT);
        const driftingCut = qty.sub(stableCut);

        this.stableAMM[side].deposit({
            reserve: stableCut,
        });

        this.driftingAMM[side].deposit({
            reserve: driftingCut,
        });
    }

    public withdraw(side: keyof TwoSided<AMM>, qty: ECs) {
        const stableCut = qty.mul(STABLE_AMM_CUT);
        const driftingCut = qty.sub(stableCut);

        this.stableAMM[side].withdraw({ depositedReserve: stableCut });
        this.driftingAMM[side].withdraw({ depositedReserve: driftingCut });
    }

    private _swap(qtyIn: ECs, direction: SwapDirection): ECs {
        const qtyOut = ECs.zero();

        let baseDirection: AMMSwapDirection;
        let quoteDirection: AMMSwapDirection;

        if (direction === "base -> quote") {
            baseDirection = "reserve -> inventory";
            quoteDirection = "inventory -> reserve";
        } else {
            baseDirection = "inventory -> reserve";
            quoteDirection = "reserve -> inventory";
        }

        const amms: [AMM, AMMSwapDirection][] = [
            [this.stableAMM.base, baseDirection],
            [this.driftingAMM.base, baseDirection],
            [this.stableAMM.quote, quoteDirection],
            [this.driftingAMM.quote, quoteDirection],
        ];

        while (true) {
            // Keep swapping with each AMM until it's fully exhausted
            for (const [amm, direction] of amms) {
                const { qtyOut: q, reminderIn } = amm.currentTick.swap({
                    direction,
                    qtyIn,
                });

                if (reminderIn.lt(qtyIn)) {
                    qtyIn = reminderIn;
                    qtyOut.addAssign(q);
                }

                if (qtyIn.isZero()) return qtyOut;
            }

            for (const [amm, direction] of amms) {
                amm.currentTick.prepareSwap(direction);
            }
        }
    }

    public get curAbsoluteTick(): number {
        return this.driftingAMM.base.currentTick.getIndex();
    }

    public get depositedReserves(): TwoSided<ECs> {
        return {
            base: this.driftingAMM.base.getDepositedReserve(),
            quote: this.driftingAMM.quote.getDepositedReserve(),
        };
    }

    public get il(): TwoSided<ECs> {
        return {
            base: this.stableAMM.base.il
                .mul(STABLE_AMM_CUT)
                .add(
                    this.driftingAMM.base.il.mul(ECs.one().sub(STABLE_AMM_CUT))
                ),
            quote: this.stableAMM.quote.il
                .mul(STABLE_AMM_CUT)
                .add(
                    this.driftingAMM.quote.il.mul(ECs.one().sub(STABLE_AMM_CUT))
                ),
        };
    }

    public get driftingReserveWidth(): TwoSided<ECs> {
        const baseWidth =
            this.driftingAMM.base.liquidity.reserve?.getWidth() ?? 0;
        const quoteWidth =
            this.driftingAMM.quote.liquidity.reserve?.getWidth() ?? 0;

        return {
            base:
                baseWidth > 0
                    ? BASE_PRICE.pow(baseWidth).div(BASE_PRICE).sub(ECs.one())
                    : ECs.zero(),
            quote:
                quoteWidth > 0
                    ? BASE_PRICE.pow(quoteWidth).div(BASE_PRICE).sub(ECs.one())
                    : ECs.zero(),
        };
    }

    public get feeFactor(): ECs {
        const { base: bf, quote: qf } = this.il;
        const { base: bw, quote: qw } = this.driftingReserveWidth;

        return this.calculateFees(bf.add(qf).div(2), bw.add(qw).div(4));
    }

    public estimatePriceImpactTicks(args: SwapArgs): number {
        let expectedOut: ECs;
        let drifting: { width: number; qty: ECs };
        let stable: { width: number; qty: ECs };

        if (args.direction === "base -> quote") {
            expectedOut = args.qtyIn.mul(
                Beacon.base(this).price(this.curAbsoluteTick)
            );

            drifting = {
                width: Math.max(
                    this.driftingAMM.quote.liquidity.reserve?.getWidth() ?? 0,
                    this.driftingAMM.base.liquidity.getInventoryWidth()
                ),
                qty: (
                    this.driftingAMM.quote.liquidity.reserve?.getReserveQty() ??
                    ECs.zero()
                )
                    .add(
                        this.driftingAMM.base.liquidity.inventory.reduce(
                            (prev, cur) => prev.add(cur.calcInventoryQty()),
                            ECs.zero()
                        )
                    )
                    .add(
                        this.driftingAMM.quote.currentTick.getCurrentReserve()
                    ),
            };

            stable = {
                width: this.stableAMM.quote.liquidity.reserve!.getWidth(),
                qty: (
                    this.stableAMM.quote.liquidity.reserve?.getReserveQty() ??
                    ECs.zero()
                )
                    .add(
                        this.stableAMM.base.liquidity.inventory.reduce(
                            (prev, cur) => prev.add(cur.calcInventoryQty()),
                            ECs.zero()
                        )
                    )
                    .add(this.stableAMM.quote.currentTick.getCurrentReserve()),
            };
        } else {
            expectedOut = args.qtyIn.mul(
                Beacon.quote(this).price(this.curAbsoluteTick)
            );

            drifting = {
                width: Math.max(
                    this.driftingAMM.base.liquidity.reserve?.getWidth() ?? 0,
                    this.driftingAMM.quote.liquidity.getInventoryWidth()
                ),
                qty: (
                    this.driftingAMM.base.liquidity.reserve?.getReserveQty() ??
                    ECs.zero()
                )
                    .add(
                        this.driftingAMM.quote.liquidity.inventory.reduce(
                            (prev, cur) => prev.add(cur.calcInventoryQty()),
                            ECs.zero()
                        )
                    )
                    .add(this.driftingAMM.base.currentTick.getCurrentReserve()),
            };

            stable = {
                width: this.stableAMM.base.liquidity.reserve!.getWidth(),
                qty: (
                    this.stableAMM.base.liquidity.reserve?.getReserveQty() ??
                    ECs.zero()
                )
                    .add(
                        this.stableAMM.quote.liquidity.inventory.reduce(
                            (prev, cur) => prev.add(cur.calcInventoryQty()),
                            ECs.zero()
                        )
                    )
                    .add(this.stableAMM.base.currentTick.getCurrentReserve()),
            };
        }

        const stablePerTickQty = stable.qty.div(stable.width);
        const driftingPerTickQty =
            drifting.width > 0
                ? drifting.qty.div(drifting.width).add(stablePerTickQty)
                : ECs.zero();

        const driftingConsumedTicks =
            drifting.width > 0
                ? Math.ceil(expectedOut.div(driftingPerTickQty).toNumber())
                : 0;

        if (driftingConsumedTicks <= drifting.width)
            return driftingConsumedTicks;

        expectedOut.subAssign(drifting.qty);

        const stableConsumedTicks = Math.ceil(
            expectedOut.div(stablePerTickQty).toNumber()
        );

        if (stableConsumedTicks <= stable.width)
            return driftingConsumedTicks + stableConsumedTicks;

        panic("Too big price impact");
    }

    private calculateFees(il: ECs, width: ECs): ECs {
        const ilFees = MIN_FEES.add(
            il.le(ECs.half())
                ? MAX_FEES.mul(il).div(ECs.half())
                : MAX_FEES.clone()
        );

        const widthFees = MIN_FEES.add(
            MAX_FEES.mul(width.gt(ECs.one()) ? ECs.one() : width)
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
                `[Pool] Ticks don't match: drifting-base=${db.curTick.idx}, drifting-quote=${dq.curTick.idx}, stable-base=${sb.curTick.idx}, stable-quote=${sq.curTick.idx}`
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

    public get overallReserve(): TwoSided<ECs> {
        const base = this.driftingAMM.base
            .getActualReserve()
            .add(this.stableAMM.base.getActualReserve())
            .add(
                this.driftingAMM.base
                    .getRespectiveReserve()
                    .add(this.stableAMM.base.getRespectiveReserve())
            );

        const quote = this.driftingAMM.quote
            .getActualReserve()
            .add(this.stableAMM.quote.getActualReserve())
            .add(
                this.driftingAMM.quote
                    .getRespectiveReserve()
                    .add(this.stableAMM.quote.getRespectiveReserve())
            );

        return { base, quote };
    }

    public get tvlQuote(): ECs {
        const { base, quote } = this.overallReserve;

        return quote.add(
            base.mul(Beacon.base(this).price(this.curAbsoluteTick))
        );
    }

    public get stats(): TwoSided<Stats> {
        const actualBaseInv = this.driftingAMM.base
            .getActualInventory()
            .add(this.stableAMM.base.getActualInventory());

        const base: Stats = {
            depositedReserve: this.driftingAMM.base
                .getDepositedReserve()
                .add(this.stableAMM.base.getDepositedReserve()),
            actualReserve: this.driftingAMM.base
                .getActualReserve()
                .add(this.stableAMM.base.getActualReserve()),
            actualInventory: actualBaseInv,
            respectiveReserve: this.driftingAMM.base
                .getRespectiveReserve()
                .add(this.stableAMM.base.getRespectiveReserve()),
            expectedReserveFromExit: actualBaseInv.mul(
                absoluteTickToPrice(this.curAbsoluteTick, "base", "inventory")
            ),
            collateral: this.driftingAMM.base.currentTick
                .getRecoveryBin()
                .getCollateral()
                .add(
                    this.stableAMM.base.currentTick
                        .getRecoveryBin()
                        .getCollateral()
                ),
        };

        const actualQuoteInv = this.driftingAMM.quote
            .getActualInventory()
            .add(this.stableAMM.quote.getActualInventory());

        const quote: Stats = {
            depositedReserve: this.driftingAMM.quote
                .getDepositedReserve()
                .add(this.stableAMM.quote.getDepositedReserve()),
            actualReserve: this.driftingAMM.quote
                .getActualReserve()
                .add(this.stableAMM.quote.getActualReserve()),
            actualInventory: actualQuoteInv,
            respectiveReserve: this.driftingAMM.quote
                .getRespectiveReserve()
                .add(this.stableAMM.quote.getRespectiveReserve()),
            expectedReserveFromExit: actualQuoteInv.mul(
                absoluteTickToPrice(this.curAbsoluteTick, "quote", "inventory")
            ),
            collateral: this.driftingAMM.quote.currentTick
                .getRecoveryBin()
                .getCollateral()
                .add(
                    this.stableAMM.quote.currentTick
                        .getRecoveryBin()
                        .getCollateral()
                ),
        };

        return { base, quote };
    }
}

export type Stats = {
    depositedReserve: ECs;
    actualReserve: ECs;
    actualInventory: ECs;
    respectiveReserve: ECs;
    expectedReserveFromExit: ECs;
    collateral: ECs;
};

export type LiquidityDigestAbsolute = {
    base: {
        reserve?: Range;
        inventory: Range[];
    };
    quote: {
        reserve?: Range;
        inventory: Range[];
    };
    currentTick: {
        idx: number;
        base: ECs;
        quote: ECs;
    };
    recoveryBinCollateral: {
        base: ECs;
        quote: ECs;
    };
};
