import { WithdrawResult } from "./amm.ts";
import { Inventory, InventoryTick, Reserve, ReserveTick } from "./liquidity.ts";
import { TickIndex } from "./ticks.ts";
import { panic } from "./utils.ts";

export type AMMSwapDirection = "reserve -> inventory" | "inventory -> reserve";

export type CurrentTickSwapArgs = {
    direction: AMMSwapDirection;
    qtyIn: number;
};

export type CurrentTickSwapResult = {
    qtyOut: number;
    reminderIn: number;
};

export class CurrentTick {
    private targetReserve: number = 0;
    private currentReserve: number = 0;

    private targetInventory: number = 0;
    private currentInventory: number = 0;

    private recoveryBin: RecoveryBin;

    public addInventoryFees(fees: number) {
        this.recoveryBin.addCollateral(fees);
    }

    public swap(args: CurrentTickSwapArgs): CurrentTickSwapResult {
        if (args.direction === "reserve -> inventory") {
            // first try to recover as much IL as possibe
            const { inventoryOut, reminderReserveIn, recoveredReserve } =
                this.recoveryBin.recover({
                    curTickIdx: this.idx.clone(),
                    reserveIn: args.qtyIn,
                });

            this.reserve.put(recoveredReserve);
            this.inventory.notifyReserveChanged();

            if (reminderReserveIn === 0) {
                return {
                    qtyOut: inventoryOut,
                    reminderIn: 0,
                };
            }

            // then, if there is no inventory in the tick, try to get a new best tick
            if (this.currentInventory === 0) {
                if (this.currentReserve > 0) {
                    // if the inventory is exhausted, make room for the next tick
                    if (this.currentReserve !== this.targetReserve)
                        panic(
                            "Current reserve should match target reserve after tick exhaustion"
                        );

                    this.reserve.put(this.currentReserve);
                    this.inventory.notifyReserveChanged();
                }

                this.cleanup();
                this.idx.inc();

                const inventoryTick = this.inventory.takeBest(this.idx);

                if (!inventoryTick)
                    return {
                        qtyOut: inventoryOut,
                        reminderIn: reminderReserveIn,
                    };

                this.putInventoryTick(inventoryTick);
            }

            const needsInventory = reminderReserveIn * this.idx.getPrice();

            // if we consume the tick only partially, leave early
            if (needsInventory < this.currentInventory) {
                this.currentInventory -= needsInventory;
                this.currentReserve += reminderReserveIn;

                return {
                    qtyOut: needsInventory,
                    reminderIn: 0,
                };
            }

            const getsInventory = this.currentInventory;
            const reminderInventory = needsInventory - getsInventory;
            const reminderReserve = reminderInventory / this.idx.getPrice();

            this.currentReserve += reminderReserveIn - reminderReserve;

            return {
                qtyOut: getsInventory,
                reminderIn: reminderReserve,
            };
        }

        // if we're swapping in an opposite direction, ask for a new tick
        if (this.currentReserve === 0) {
            if (this.currentInventory > 0) {
                // if the reserve is exhausted, make room for the next tick
                if (this.currentInventory !== this.targetInventory)
                    panic(
                        "Current inventory should match target inventory after tick exhaustion"
                    );

                this.inventory.putBest({
                    idx: this.idx.clone(),
                    inventory: this.currentInventory,
                });
            }

            this.cleanup();
            this.idx.dec();

            const reserveTick = this.reserve.takeBest();

            if (!reserveTick)
                return {
                    qtyOut: 0,
                    reminderIn: args.qtyIn,
                };

            this.putReserveTick(reserveTick);
        }

        const needsReserve = args.qtyIn / this.idx.getPrice();

        if (needsReserve < this.currentReserve) {
            this.currentReserve -= needsReserve;
            this.currentInventory += args.qtyIn;

            return {
                qtyOut: needsReserve,
                reminderIn: 0,
            };
        }

        const getsReserve = this.currentReserve;
        const reminderReserve = needsReserve - getsReserve;
        const reminderInventory = reminderReserve * this.idx.getPrice();

        this.currentReserve = 0;
        this.currentInventory += args.qtyIn - reminderInventory;

        return {
            qtyOut: getsReserve,
            reminderIn: reminderInventory,
        };
    }

    public deposit(reserve: number) {
        this.targetReserve += reserve;
        this.currentReserve += reserve;

        this.targetInventory = this.targetReserve * this.idx.getPrice();
    }

    public withdrawCut(cut: number): WithdrawResult {
        const reserve = this.currentReserve * cut;
        this.currentReserve -= reserve;
        this.targetReserve *= cut;

        const inventory = this.currentInventory * cut;
        this.currentInventory -= inventory;
        this.targetInventory *= cut;

        const recoveryBinInventory = this.recoveryBin.withdrawCut(cut);

        return { reserve, inventory: inventory + recoveryBinInventory };
    }

    public index(): TickIndex {
        return this.idx.clone();
    }

    public hasReserve() {
        return this.targetReserve + this.currentReserve + 0;
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

        this.targetReserve = this.targetInventory / this.idx.getPrice();
    }

    private putReserveTick(tick: ReserveTick) {
        if (tick.idx !== this.idx) panic("Ticks don't match");

        this.targetReserve += tick.reserve;
        this.currentReserve += tick.reserve;

        this.targetInventory = this.targetReserve * this.idx.getPrice();
    }

    constructor(
        private idx: TickIndex,
        private reserve: Reserve,
        private inventory: Inventory
    ) {
        this.recoveryBin = new RecoveryBin(reserve, inventory);
    }
}

export type RecoverArgs = {
    reserveIn: number;
    curTickIdx: TickIndex;
};

export type RecoverResult = {
    inventoryOut: number;
    reminderReserveIn: number;
    recoveredReserve: number;
};

export class RecoveryBin {
    private collateral: number = 0;
    private worstTick: InventoryTick | undefined = undefined;

    public withdrawCut(cut: number): number {
        let inventoryToWithdraw = this.collateral * cut;

        if (this.worstTick) {
            const worstTickCut = this.worstTick.inventory * cut;
            inventoryToWithdraw += worstTickCut;

            this.worstTick.inventory -= worstTickCut;

            if (this.worstTick.inventory === 0) {
                this.worstTick = undefined;
            }
        }

        return inventoryToWithdraw;
    }

    // only executed if the current swap is 'reserve -> inventory'
    public recover(args: RecoverArgs): RecoverResult {
        // take the worst IL tick
        // if there is none, just skip - save the collateral for future recoveries
        if (!this.worstTick) {
            this.worstTick = this.inventory.takeWorst();
            if (!this.worstTick)
                return {
                    inventoryOut: 0,
                    reminderReserveIn: args.reserveIn,
                    recoveredReserve: 0,
                };
        }

        // if there is no collateral, but we're currently selling off the worst tick
        // return the worst tick back to the Inventory, so it can sell it according to its own rules
        if (!this.hasCollateral() && this.worstTick.idx.eq(args.curTickIdx)) {
            this.inventory.putWorstNewRange(this.worstTick);
            this.worstTick = undefined;

            return {
                inventoryOut: 0,
                reminderReserveIn: args.reserveIn,
                recoveredReserve: 0,
            };
        }

        // calculate, how much of the inventory we can recover at the current price, using the collateral (fees) we've accumulated so far

        // the formula is dI = min(I, X*P1 / |P1-P0|), where I is worst tick's inventory, X is the collateral, P0 is the worst tick's price and P1 is current price
        // dI is the portion of inventory from the worst tick, that can be sold alongside the collateral right now to break even in terms of reserves

        const p0 = this.worstTick.idx.getPrice();
        const p1 = args.curTickIdx.getPrice();
        const I = this.worstTick.inventory;
        const X = this.collateral;

        const dI = Math.min(I, (X * p1) / Math.abs(p1 - p0));

        const hasInventory = this.collateral + dI;
        const needsInventory = args.reserveIn * p1;

        if (hasInventory >= needsInventory) {
            const leftoverInventory = hasInventory - needsInventory;
            const leftoverCut = leftoverInventory / hasInventory;

            this.collateral *= leftoverCut;
            const leftoverWorstTick = dI * leftoverCut;

            this.worstTick.inventory =
                this.worstTick.inventory - dI + leftoverWorstTick;

            return {
                inventoryOut: needsInventory,
                reminderReserveIn: 0,
                recoveredReserve: args.reserveIn,
            };
        }

        const takeInventory = hasInventory;
        const takeReserve = takeInventory / p1;

        this.collateral = 0;
        this.worstTick.inventory -= dI;

        if (this.worstTick.inventory === 0) {
            this.worstTick = undefined;
        }

        return {
            inventoryOut: takeInventory,
            reminderReserveIn: args.reserveIn - takeReserve,
            recoveredReserve: takeReserve,
        };
    }

    public addCollateral(fees: number) {
        this.collateral += fees;
    }

    public hasCollateral(): boolean {
        return this.collateral > 0;
    }

    constructor(private reserve: Reserve, private inventory: Inventory) {}
}
