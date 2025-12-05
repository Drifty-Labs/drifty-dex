import {
    Inventory,
    type InventoryTick,
    Liquidity,
    type ReserveTick,
    type WithdrawResult,
} from "./liquidity.ts";
import { absoluteTickToPrice, almostEq, panic, type Side } from "./utils.ts";

export type AMMSwapDirection = "reserve -> inventory" | "inventory -> reserve";

export type CurrentTickSwapArgs = {
    direction: AMMSwapDirection;
    qtyIn: number;
};

export type CurrentTickSwapResult = {
    qtyOut: number;
    reminderIn: number;
    tickExhausted: boolean;
    recoveredReserve: number;
};

export class CurrentTick {
    private targetReserve: number = 0;
    private currentReserve: number = 0;

    private targetInventory: number = 0;
    private currentInventory: number = 0;

    private recoveryBin: RecoveryBin;

    constructor(
        private side: Side,
        private isDrifting: boolean,
        private idx: number,
        private liquidity: Liquidity,
        private noLogs: boolean
    ) {
        this.recoveryBin = new RecoveryBin(side, liquidity, noLogs, isDrifting);
    }

    public clone(newLiquidity: Liquidity, noLogs: boolean) {
        const c = new CurrentTick(
            this.side,
            this.isDrifting,
            this.idx,
            newLiquidity,
            noLogs
        );

        c.targetReserve = this.targetReserve;
        c.currentReserve = this.currentReserve;
        c.targetInventory = this.targetInventory;
        c.currentInventory = this.currentInventory;
        c.recoveryBin = this.recoveryBin.clone(newLiquidity, noLogs);

        return c;
    }

    public getLiquidity(): { reserve: number; inventory: number } {
        return {
            reserve: this.currentReserve,
            inventory: this.currentInventory,
        };
    }

    public addInventoryFees(fees: number) {
        this.recoveryBin.addCollateral(fees);
    }

    public swap(args: CurrentTickSwapArgs): CurrentTickSwapResult {
        if (args.direction === "reserve -> inventory") {
            // first try to recover as much IL as possible
            let inventoryOut = 0,
                reminderReserveIn = args.qtyIn,
                recoveredReserve = 0;

            // recover until exhausted
            while (true) {
                const {
                    inventoryOut: io,
                    reminderReserveIn: ri,
                    recoveredReserve: rr,
                } = this.recoveryBin.recover({
                    curTickIdx: this.idx,
                    reserveIn: reminderReserveIn,
                });

                if (rr === 0) break;

                inventoryOut += io;
                reminderReserveIn = ri;
                recoveredReserve += rr;
            }

            if (almostEq(reminderReserveIn, 0)) {
                return {
                    qtyOut: inventoryOut,
                    reminderIn: 0,
                    tickExhausted: false,
                    recoveredReserve,
                };
            }

            if (almostEq(this.currentInventory, 0))
                return {
                    qtyOut: inventoryOut,
                    reminderIn: reminderReserveIn,
                    tickExhausted: true,
                    recoveredReserve,
                };

            const needsInventory =
                reminderReserveIn *
                absoluteTickToPrice(this.idx, this.side, "reserve");

            // if we consume the tick only partially, leave early
            if (needsInventory < this.currentInventory) {
                this.currentInventory -= needsInventory;
                this.currentReserve += reminderReserveIn;

                return {
                    qtyOut: needsInventory,
                    reminderIn: 0,
                    tickExhausted: false,
                    recoveredReserve,
                };
            }

            const getsInventory = this.currentInventory;
            const reminderInventory = needsInventory - getsInventory;
            const reminderReserve =
                reminderInventory *
                absoluteTickToPrice(this.idx, this.side, "inventory");

            this.currentReserve += reminderReserveIn - reminderReserve;
            this.currentInventory = 0; // Fully consumed

            return {
                qtyOut: getsInventory,
                reminderIn: reminderReserve,
                tickExhausted: true,
                recoveredReserve,
            };
        }

        if (almostEq(this.currentReserve, 0))
            return {
                qtyOut: 0,
                reminderIn: args.qtyIn,
                tickExhausted: true,
                recoveredReserve: 0,
            };

        const needsReserve =
            args.qtyIn * absoluteTickToPrice(this.idx, this.side, "inventory");

        if (needsReserve < this.currentReserve) {
            this.currentReserve -= needsReserve;
            this.currentInventory += args.qtyIn;

            return {
                qtyOut: needsReserve,
                reminderIn: 0,
                tickExhausted: false,
                recoveredReserve: 0,
            };
        }

        const getsReserve = this.currentReserve;
        const reminderReserve = needsReserve - getsReserve;
        const reminderInventory =
            reminderReserve *
            absoluteTickToPrice(this.idx, this.side, "reserve");

        this.currentReserve = 0;
        this.currentInventory += args.qtyIn - reminderInventory;

        return {
            qtyOut: getsReserve,
            reminderIn: reminderInventory,
            tickExhausted: true,
            recoveredReserve: 0,
        };
    }

    public nextReserveTick() {
        if (!almostEq(this.currentReserve, 0)) {
            panic(
                "Switching to next reserve tick is only possible when the previous one is empty"
            );
        }

        const inventoryTick: InventoryTick | undefined =
            this.currentInventory === 0
                ? undefined
                : {
                      idx: this.idx,
                      inventory: this.currentInventory,
                  };

        this.cleanup();

        if (this.isBase()) {
            this.idx += 1;
        } else {
            this.idx -= 1;
        }

        const reserveTick = this.liquidity.obtainReserveTick(inventoryTick);

        if (reserveTick) this.putReserveTick(reserveTick);
    }

    public nextInventoryTick() {
        if (!almostEq(this.currentInventory, 0)) {
            panic(
                "Switching to next inventory tick is only possible when the previous one is empty"
            );
        }

        const reserveTick: ReserveTick | undefined =
            this.currentReserve === 0
                ? undefined
                : { idx: this.idx, reserve: this.currentReserve };

        this.cleanup();

        if (this.isBase()) {
            this.idx -= 1;
        } else {
            this.idx += 1;
        }

        const inventoryTick = this.liquidity.obtainInventoryTick(
            reserveTick,
            this.idx
        );

        if (inventoryTick) this.putInventoryTick(inventoryTick);
    }

    public withdrawCut(cut: number): WithdrawResult {
        const reserve = this.currentReserve * cut;
        this.currentReserve -= reserve;
        this.targetReserve *= 1 - cut;

        const inventory = this.currentInventory * cut;
        this.currentInventory -= inventory;
        this.targetInventory *= 1 - cut;

        const recoveryBinInventory = this.recoveryBin.withdrawCut(cut);

        return { reserve, inventory: inventory + recoveryBinInventory };
    }

    public get index(): number {
        return this.idx;
    }

    public hasInventory() {
        return this.currentInventory > 0;
    }

    public hasReserve(): boolean {
        return this.currentReserve > 0;
    }

    public isBase() {
        return this.side === "base";
    }

    private cleanup() {
        this.targetInventory = 0;
        this.targetReserve = 0;
        this.currentInventory = 0;
        this.currentReserve = 0;
    }

    private putInventoryTick(tick: InventoryTick) {
        if (tick.idx !== this.idx)
            panic(`Ticks don't match: old=${this.idx}, new=${tick.idx}`);

        this.targetInventory += tick.inventory;
        this.currentInventory += tick.inventory;

        this.targetReserve =
            this.targetInventory *
            absoluteTickToPrice(this.idx, this.side, "inventory");
    }

    private putReserveTick(tick: ReserveTick) {
        if (tick.idx !== this.idx)
            panic(`Ticks don't match: old=${this.idx} new=${tick.idx}`);

        this.targetReserve += tick.reserve;
        this.currentReserve += tick.reserve;

        this.targetInventory =
            this.targetReserve *
            absoluteTickToPrice(this.idx, this.side, "reserve");
    }

    public getRecoveryBin() {
        return this.recoveryBin;
    }

    public get reserve() {
        return this.currentReserve;
    }

    public get Inventory() {
        return this.currentInventory;
    }
}

export type RecoverArgs = {
    reserveIn: number;
    curTickIdx: number;
};

export type RecoverResult = {
    inventoryOut: number;
    reminderReserveIn: number;
    recoveredReserve: number;
};

/**
 * Fee-funded IL repair engine that focuses on a single worst tick at a time.
 */
export class RecoveryBin {
    private _collateral: number = 0;
    private _worstTick: InventoryTick | undefined = undefined;

    constructor(
        private side: Side,
        private liquidity: Liquidity,
        private noLogs: boolean,
        private isDrifting: boolean
    ) {}

    public clone(newLiquidity: Liquidity, noLogs: boolean) {
        const r = new RecoveryBin(
            this.side,
            newLiquidity,
            noLogs,
            this.isDrifting
        );

        r._collateral = this._collateral;
        r._worstTick = this._worstTick
            ? {
                  idx: this._worstTick.idx,
                  inventory: this._worstTick.inventory,
              }
            : undefined;

        return r;
    }

    public withdrawCut(cut: number): number {
        if (this._worstTick) {
            panic("Worst tick should not be present outside of swaps");
        }

        const collateralToWithdraw = this._collateral * cut;
        this._collateral -= collateralToWithdraw;

        return collateralToWithdraw;
    }

    /**
     * Uses collateral + the worst inventory tick to offset fresh reserve inflow.
     */
    public recover(args: RecoverArgs): RecoverResult {
        const inventory = this.liquidity.inventory;

        if (almostEq(this._collateral, 0))
            return {
                inventoryOut: 0,
                recoveredReserve: 0,
                reminderReserveIn: args.reserveIn,
            };

        this._worstTick = inventory.takeWorst();

        if (!this._worstTick) {
            if (almostEq(this.collateral, 0))
                return {
                    inventoryOut: 0,
                    recoveredReserve: 0,
                    reminderReserveIn: args.reserveIn,
                };

            const reserveForCollateral =
                this.collateral *
                absoluteTickToPrice(args.curTickIdx, this.side, "inventory");

            if (args.reserveIn >= reserveForCollateral) {
                const inventoryOut = this.collateral;
                const recoveredReserve = reserveForCollateral;
                const reminderIn = args.reserveIn - reserveForCollateral;

                this._collateral = 0;
                return {
                    inventoryOut,
                    recoveredReserve,
                    reminderReserveIn: reminderIn,
                };
            }

            const usedShare = args.reserveIn / reserveForCollateral;
            const inventoryOut = this.collateral * usedShare;
            const recoveredReserve = reserveForCollateral * usedShare;

            this._collateral -= inventoryOut;

            return {
                inventoryOut,
                recoveredReserve,
                reminderReserveIn: 0,
            };
        }

        // guarantees no division by zero below
        if (this._worstTick.idx === args.curTickIdx) {
            this.liquidity.inventory.putWorstNewRange(this._worstTick);
            this._worstTick = undefined;

            return {
                inventoryOut: 0,
                recoveredReserve: 0,
                reminderReserveIn: args.reserveIn,
            };
        }

        const worstTickRespectiveReserve =
            this._worstTick.inventory *
            absoluteTickToPrice(this._worstTick.idx, this.side, "inventory");

        if (args.reserveIn >= worstTickRespectiveReserve) {
            const curTickProducedInventory =
                worstTickRespectiveReserve *
                absoluteTickToPrice(args.curTickIdx, this.side, "reserve");

            if (curTickProducedInventory < this._worstTick.inventory)
                panic(
                    "Should always require more inventory to recover the tick"
                );
            const missingInventoryToBreakEven =
                curTickProducedInventory - this._worstTick.inventory;

            // if we have enough
            if (this._collateral >= missingInventoryToBreakEven) {
                this._collateral -= missingInventoryToBreakEven;
                this._worstTick = undefined;

                const recoveredReserve = worstTickRespectiveReserve;
                const inventoryOut = curTickProducedInventory;
                const reminderIn = args.reserveIn - recoveredReserve;

                return {
                    recoveredReserve,
                    inventoryOut,
                    reminderReserveIn: reminderIn,
                };
            }

            const recoveredShare =
                this._collateral / missingInventoryToBreakEven;
            const inventoryOut =
                this.collateral + this._worstTick.inventory * recoveredShare;

            this._collateral = 0;
            this._worstTick.inventory *= 1 - recoveredShare;
            this.liquidity.inventory.putWorstNewRange(this._worstTick);
            this._worstTick = undefined;

            const recoveredReserve =
                inventoryOut *
                absoluteTickToPrice(args.curTickIdx, this.side, "inventory");
            const reminderIn = args.reserveIn - recoveredReserve;

            return {
                recoveredReserve,
                inventoryOut,
                reminderReserveIn: reminderIn,
            };
        }

        const recoveredShare = args.reserveIn / worstTickRespectiveReserve;
        const recoveredReserve = args.reserveIn;
        const inventoryOut =
            recoveredReserve *
            absoluteTickToPrice(args.curTickIdx, this.side, "reserve");

        this._collateral *= recoveredShare;
        this._worstTick.inventory *= recoveredShare;
        this.liquidity.inventory.putWorstNewRange(this._worstTick);
        this._worstTick = undefined;

        return {
            recoveredReserve,
            inventoryOut,
            reminderReserveIn: 0,
        };
    }

    public isBase() {
        return this.side === "base";
    }

    public unsetWorstTick() {
        this._worstTick = undefined;
    }

    public addCollateral(fees: number) {
        this._collateral += fees;
    }

    public hasCollateral(): boolean {
        return this._collateral > 0;
    }

    public get collateral(): number {
        return this._collateral;
    }
}
