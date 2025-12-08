import { E8s } from "./ecs.ts";
import {
    type InventoryTick,
    Liquidity,
    type ReserveTick,
    type WithdrawResult,
} from "./liquidity.ts";
import { absoluteTickToPrice, panic, type Side } from "./utils.ts";

export type AMMSwapDirection = "reserve -> inventory" | "inventory -> reserve";

export type CurrentTickSwapArgs = {
    direction: AMMSwapDirection;
    qtyIn: E8s;
};

export type CurrentTickSwapResult = {
    qtyOut: E8s;
    reminderIn: E8s;
    recoveredReserve: E8s;
};

export class CurrentTick {
    private targetReserve = E8s.zero();
    private currentReserve = E8s.zero();

    private targetInventory = E8s.zero();
    private currentInventory = E8s.zero();

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

        c.targetReserve = this.targetReserve.clone();
        c.currentReserve = this.currentReserve.clone();
        c.targetInventory = this.targetInventory.clone();
        c.currentInventory = this.currentInventory.clone();
        c.recoveryBin = this.recoveryBin.clone(newLiquidity, noLogs);

        return c;
    }

    public getLiquidity(): { reserve: E8s; inventory: E8s } {
        return {
            reserve: this.currentReserve.clone(),
            inventory: this.currentInventory.clone(),
        };
    }

    public addInventoryFees(fees: E8s) {
        this.recoveryBin.addCollateral(fees);
    }

    public swap(args: CurrentTickSwapArgs): CurrentTickSwapResult {
        if (args.direction === "reserve -> inventory") {
            // first try to recover as much IL as possible
            const inventoryOut = E8s.zero(),
                recoveredReserve = E8s.zero();

            let reminderReserveIn = args.qtyIn.clone();

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

                if (rr.isZero()) break;

                inventoryOut.addAssign(io);
                reminderReserveIn = ri.clone();
                recoveredReserve.addAssign(rr);
            }

            if (reminderReserveIn.isZero()) {
                return {
                    qtyOut: inventoryOut,
                    reminderIn: E8s.zero(),
                    recoveredReserve,
                };
            }

            if (this.currentInventory.isZero())
                return {
                    qtyOut: inventoryOut,
                    reminderIn: reminderReserveIn,
                    recoveredReserve,
                };

            const needsInventory = reminderReserveIn.mul(
                absoluteTickToPrice(this.idx, this.side, "reserve")
            );

            // if we consume the tick only partially, leave early
            if (needsInventory.lt(this.currentInventory)) {
                this.currentInventory.subAssign(needsInventory);
                this.currentReserve.addAssign(reminderReserveIn);

                return {
                    qtyOut: needsInventory,
                    reminderIn: E8s.zero(),
                    recoveredReserve,
                };
            }

            const getsInventory = this.currentInventory.clone();
            const reminderInventory = needsInventory.sub(getsInventory);
            const reminderReserve = reminderInventory.mul(
                absoluteTickToPrice(this.idx, this.side, "inventory")
            );

            this.currentReserve.addAssign(
                reminderReserveIn.sub(reminderReserve)
            );
            this.currentInventory = E8s.zero();

            return {
                qtyOut: getsInventory,
                reminderIn: reminderReserve,
                recoveredReserve,
            };
        }

        if (this.currentReserve.isZero())
            return {
                qtyOut: E8s.zero(),
                reminderIn: args.qtyIn,
                recoveredReserve: E8s.zero(),
            };

        const needsReserve = args.qtyIn.mul(
            absoluteTickToPrice(this.idx, this.side, "inventory")
        );

        if (needsReserve.lt(this.currentReserve)) {
            this.currentReserve.subAssign(needsReserve);
            this.currentInventory.addAssign(args.qtyIn);

            return {
                qtyOut: needsReserve,
                reminderIn: E8s.zero(),
                recoveredReserve: E8s.zero(),
            };
        }

        const getsReserve = this.currentReserve.clone();
        const reminderReserve = needsReserve.sub(getsReserve);
        const reminderInventory = reminderReserve.mul(
            absoluteTickToPrice(this.idx, this.side, "reserve")
        );

        this.currentReserve = E8s.zero();
        this.currentInventory.addAssign(args.qtyIn.sub(reminderInventory));

        return {
            qtyOut: getsReserve,
            reminderIn: reminderInventory,
            recoveredReserve: E8s.zero(),
        };
    }

    public nextReserveTick() {
        if (!this.currentReserve.isZero()) {
            panic(
                "Switching to next reserve tick is only possible when the previous one is empty"
            );
        }

        const inventoryTick: InventoryTick | undefined =
            this.currentInventory.isZero()
                ? undefined
                : {
                      idx: this.idx,
                      inventory: this.currentInventory.clone(),
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
        if (!this.currentInventory.isZero()) {
            panic(
                "Switching to next inventory tick is only possible when the previous one is empty"
            );
        }

        const reserveTick: ReserveTick | undefined =
            this.currentReserve.isZero()
                ? undefined
                : { idx: this.idx, reserve: this.currentReserve.clone() };

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

    public withdrawCut(cut: E8s): WithdrawResult {
        const reserve = this.currentReserve.mul(cut);
        this.currentReserve.subAssign(reserve);
        this.targetReserve.mulAssign(E8s.one().sub(cut));

        const inventory = this.currentInventory.mul(cut);
        this.currentInventory.subAssign(inventory);
        this.targetInventory.mulAssign(E8s.one().sub(cut));

        const recoveryBinInventory = this.recoveryBin.withdrawCut(cut);

        return { reserve, inventory: inventory.add(recoveryBinInventory) };
    }

    public get index(): number {
        return this.idx;
    }

    public hasInventory() {
        return this.currentInventory.isPositive();
    }

    public hasReserve(): boolean {
        return this.currentReserve.isPositive();
    }

    public isBase() {
        return this.side === "base";
    }

    private cleanup() {
        this.targetInventory = E8s.zero();
        this.targetReserve = E8s.zero();
        this.currentInventory = E8s.zero();
        this.currentReserve = E8s.zero();
    }

    private putInventoryTick(tick: InventoryTick) {
        if (tick.idx !== this.idx)
            panic(`Ticks don't match: old=${this.idx}, new=${tick.idx}`);

        this.targetInventory.addAssign(tick.inventory);
        this.currentInventory.addAssign(tick.inventory);

        this.targetReserve = this.targetInventory.mul(
            absoluteTickToPrice(this.idx, this.side, "inventory")
        );
    }

    private putReserveTick(tick: ReserveTick) {
        if (tick.idx !== this.idx)
            panic(`Ticks don't match: old=${this.idx} new=${tick.idx}`);

        this.targetReserve.addAssign(tick.reserve);
        this.currentReserve.addAssign(tick.reserve);

        this.targetInventory = this.targetReserve.mul(
            absoluteTickToPrice(this.idx, this.side, "reserve")
        );
    }

    public getRecoveryBin() {
        return this.recoveryBin;
    }

    public get reserve() {
        return this.currentReserve.clone();
    }

    public get inventory() {
        return this.currentInventory.clone();
    }
}

export type RecoverArgs = {
    reserveIn: E8s;
    curTickIdx: number;
};

export type RecoverResult = {
    inventoryOut: E8s;
    reminderReserveIn: E8s;
    recoveredReserve: E8s;
};

/**
 * Fee-funded IL repair engine that focuses on a single worst tick at a time.
 */
export class RecoveryBin {
    private _collateral = E8s.zero();
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

        r._collateral = this._collateral.clone();
        r._worstTick = this._worstTick
            ? {
                  idx: this._worstTick.idx,
                  inventory: this._worstTick.inventory.clone(),
              }
            : undefined;

        return r;
    }

    public withdrawCut(cut: E8s): E8s {
        if (this._worstTick) {
            panic("Worst tick should not be present outside of swaps");
        }

        const collateralToWithdraw = this._collateral.mul(cut);
        this._collateral.subAssign(collateralToWithdraw);

        return collateralToWithdraw;
    }

    /**
     * Uses collateral + the worst inventory tick to offset fresh reserve inflow.
     */
    public recover(args: RecoverArgs): RecoverResult {
        const inventory = this.liquidity.inventory;

        if (this._collateral.isZero())
            return {
                inventoryOut: E8s.zero(),
                recoveredReserve: E8s.zero(),
                reminderReserveIn: args.reserveIn.clone(),
            };

        this._worstTick = inventory.takeWorst();

        if (!this._worstTick) {
            const reserveForCollateral = this.collateral.mul(
                absoluteTickToPrice(args.curTickIdx, this.side, "inventory")
            );

            if (args.reserveIn.ge(reserveForCollateral)) {
                const inventoryOut = this.collateral.clone();
                const recoveredReserve = reserveForCollateral.clone();
                const reminderIn = args.reserveIn.sub(reserveForCollateral);

                this._collateral = E8s.zero();

                return {
                    inventoryOut,
                    recoveredReserve,
                    reminderReserveIn: reminderIn,
                };
            }

            const usedShare = args.reserveIn.div(reserveForCollateral);
            const inventoryOut = this.collateral.mul(usedShare);
            const recoveredReserve = reserveForCollateral.mul(usedShare);

            this._collateral.subAssign(inventoryOut);

            return {
                inventoryOut,
                recoveredReserve,
                reminderReserveIn: E8s.zero(),
            };
        }

        // guarantees no division by zero below
        if (this._worstTick.idx === args.curTickIdx) {
            this.liquidity.inventory.putWorstNewRange(this._worstTick);
            this._worstTick = undefined;

            return {
                inventoryOut: E8s.zero(),
                recoveredReserve: E8s.zero(),
                reminderReserveIn: args.reserveIn.clone(),
            };
        }

        const worstTickRespectiveReserve = this._worstTick.inventory.mul(
            absoluteTickToPrice(this._worstTick.idx, this.side, "inventory")
        );

        if (args.reserveIn.ge(worstTickRespectiveReserve)) {
            const curTickProducedInventory = worstTickRespectiveReserve.mul(
                absoluteTickToPrice(args.curTickIdx, this.side, "reserve")
            );

            if (curTickProducedInventory.lt(this._worstTick.inventory)) {
                const wti = this._worstTick.inventory.toNumber();
                const wtrr = wti * Math.pow(1.0001, this._worstTick.idx);
                const ctpi = wtrr / Math.pow(1.0001, args.curTickIdx);

                console.log(
                    this.side,
                    `${this._worstTick.idx} (${this._worstTick.inventory}) -> ${worstTickRespectiveReserve} -> ${args.curTickIdx} (${curTickProducedInventory})`
                );
                console.log(
                    this.side,
                    `${this._worstTick.idx} (${wti}) -> ${wtrr} -> ${args.curTickIdx} (${ctpi})`
                );

                panic(
                    "Should always require more inventory to recover the tick"
                );
            }

            const missingInventoryToBreakEven = curTickProducedInventory.sub(
                this._worstTick.inventory
            );

            // if we have enough
            if (this._collateral.ge(missingInventoryToBreakEven)) {
                this._collateral.subAssign(missingInventoryToBreakEven);
                this._worstTick = undefined;

                const recoveredReserve = worstTickRespectiveReserve.clone();
                const inventoryOut = curTickProducedInventory.clone();
                const reminderIn = args.reserveIn.sub(recoveredReserve);

                return {
                    recoveredReserve,
                    inventoryOut,
                    reminderReserveIn: reminderIn,
                };
            }

            const recoveredShare = this._collateral.div(
                missingInventoryToBreakEven
            );
            const inventoryOut = this.collateral.add(
                this._worstTick.inventory.mul(recoveredShare)
            );

            this._collateral = E8s.zero();
            this._worstTick.inventory.mul(E8s.one().sub(recoveredShare));
            this.liquidity.inventory.putWorstNewRange(this._worstTick);
            this._worstTick = undefined;

            const recoveredReserve = inventoryOut.mul(
                absoluteTickToPrice(args.curTickIdx, this.side, "inventory")
            );
            const reminderIn = args.reserveIn.sub(recoveredReserve);

            return {
                recoveredReserve,
                inventoryOut,
                reminderReserveIn: reminderIn,
            };
        }

        const recoveredShare = args.reserveIn.div(worstTickRespectiveReserve);
        const recoveredReserve = args.reserveIn.clone();
        const inventoryOut = recoveredReserve.mul(
            absoluteTickToPrice(args.curTickIdx, this.side, "reserve")
        );

        this._collateral.mulAssign(recoveredShare);
        this._worstTick.inventory.mulAssign(recoveredShare);
        this.liquidity.inventory.putWorstNewRange(this._worstTick);
        this._worstTick = undefined;

        return {
            recoveredReserve,
            inventoryOut,
            reminderReserveIn: E8s.zero(),
        };
    }

    public isBase() {
        return this.side === "base";
    }

    public unsetWorstTick() {
        this._worstTick = undefined;
    }

    public addCollateral(fees: E8s) {
        this._collateral.addAssign(fees);
    }

    public hasCollateral(): boolean {
        return this._collateral.isPositive();
    }

    public get collateral(): E8s {
        return this._collateral;
    }
}
