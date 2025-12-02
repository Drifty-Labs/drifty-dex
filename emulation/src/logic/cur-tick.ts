import {
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
        private idx: number,
        private liquidity: Liquidity
    ) {
        this.recoveryBin = new RecoveryBin(side, liquidity);
    }

    public clone(newLiquidity: Liquidity) {
        const c = new CurrentTick(this.side, this.idx, newLiquidity);

        c.targetReserve = this.targetReserve;
        c.currentReserve = this.currentReserve;
        c.targetInventory = this.targetInventory;
        c.currentInventory = this.currentInventory;
        c.recoveryBin = this.recoveryBin.clone(newLiquidity);

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
                // Add to reserve
                const recoveredReserve = reminderReserveIn;
                this.currentReserve += recoveredReserve;

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

        const inventoryTick: InventoryTick | undefined = almostEq(
            this.targetInventory,
            0
        )
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

        const reserveTick: ReserveTick | undefined = almostEq(
            this.targetReserve,
            0
        )
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

    public deposit(reserve: number) {
        this.targetReserve += reserve;
        this.currentReserve += reserve;

        this.targetInventory =
            this.targetReserve *
            absoluteTickToPrice(this.idx, this.side, "reserve");
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
        if (tick.idx !== this.idx) panic("Ticks don't match");

        this.targetInventory += tick.inventory;
        this.currentInventory += tick.inventory;

        this.targetReserve =
            this.targetInventory *
            absoluteTickToPrice(this.idx, this.side, "inventory");
    }

    private putReserveTick(tick: ReserveTick) {
        if (tick.idx !== this.idx) panic("Ticks don't match");

        this.targetReserve += tick.reserve;
        this.currentReserve += tick.reserve;

        this.targetInventory =
            this.targetReserve *
            absoluteTickToPrice(this.idx, this.side, "reserve");
    }

    public getRecoveryBin() {
        return this.recoveryBin;
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

    constructor(private side: Side, private liquidity: Liquidity) {}

    public clone(newLiquidity: Liquidity) {
        const r = new RecoveryBin(this.side, newLiquidity);

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
     *
     * - If no worst tick is cached, it pops one from {@link Inventory.takeRight}.
     * - If the current price equals the worst tick and there is no collateral,
     *   the tick is returned untouched—the outer swap will sell it normally.
     * - Otherwise it applies `dI = min(I, X*P1 / |P1-P0|)` to determine how
     *   much inventory can be safely recovered right now.
     */
    public recover(args: RecoverArgs): RecoverResult {
        const inventory = this.liquidity.inventory;

        if (almostEq(this._collateral, 0))
            return {
                inventoryOut: 0,
                recoveredReserve: 0,
                reminderReserveIn: args.reserveIn,
            };

        try {
            this._worstTick = inventory.takeWorst();

            if (!this._worstTick)
                return {
                    inventoryOut: 0,
                    recoveredReserve: 0,
                    reminderReserveIn: args.reserveIn,
                };
        } catch (e) {
            console.error(this.liquidity.clone());
            throw e;
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

        // Raw prices for ratio calculations
        const p0 = absoluteTickToPrice(
            this._worstTick.idx,
            this.side,
            "reserve"
        );
        const p1 = absoluteTickToPrice(args.curTickIdx, this.side, "reserve");
        const I = this._worstTick.inventory;
        const X = this._collateral;

        const maxdI = (X * p1) / Math.abs(p1 - p0);
        const dI = Math.min(I, maxdI);

        const hasInventory = this._collateral + dI;
        const needsInventory =
            args.reserveIn *
            absoluteTickToPrice(args.curTickIdx, this.side, "reserve");

        if (hasInventory > needsInventory) {
            const leftoverInventory = hasInventory - needsInventory;
            const leftoverCut = leftoverInventory / hasInventory;

            this._collateral *= leftoverCut;
            const leftoverWorstTick = dI * leftoverCut;

            this._worstTick.inventory =
                this._worstTick.inventory - dI + leftoverWorstTick;

            this.liquidity.inventory.putWorstNewRange(this._worstTick);
            this._worstTick = undefined;

            return {
                inventoryOut: needsInventory,
                reminderReserveIn: 0,
                recoveredReserve: args.reserveIn,
            };
        }

        const takeInventory = hasInventory;
        const takeReserve =
            takeInventory *
            absoluteTickToPrice(args.curTickIdx, this.side, "inventory");

        this._worstTick.inventory -= dI;

        const dICut = dI / maxdI;
        this._collateral *= 1 - dICut;

        if (almostEq(this._worstTick.inventory, 0)) {
            this._worstTick = undefined;
        } else {
            this.liquidity.inventory.putWorstNewRange(this._worstTick);
            this._worstTick = undefined;
        }

        return {
            inventoryOut: takeInventory,
            reminderReserveIn: args.reserveIn - takeReserve,
            recoveredReserve: takeReserve,
        };
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

    public get worstTick(): InventoryTick | undefined {
        return this._worstTick;
    }

    public get collateral(): number {
        return this._collateral;
    }
}
