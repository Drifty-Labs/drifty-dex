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

/**
 * Represents the current price tick in the AMM.
 * This class manages the liquidity at the current tick, handling swaps and transitions to adjacent ticks.
 * It also contains the `RecoveryBin`, which is responsible for impermanent loss mitigation.
 */
export class CurrentTick {
    private targetReserve: number = 0;
    private currentReserve: number = 0;

    private targetInventory: number = 0;
    private currentInventory: number = 0;

    private recoveryBin: RecoveryBin;

    /**
     * Adds fees to the recovery bin to be used as collateral for IL recovery.
     * @param fees The amount of fees to add.
     */
    public addInventoryFees(fees: number) {
        this.recoveryBin.addCollateral(fees);
    }

    /**
     * Executes a swap within the current tick.
     *
     * This function handles the logic for swapping assets in either direction (reserve to inventory or inventory to reserve).
     * It first attempts to use the `RecoveryBin` to recover any impermanent loss. If there is remaining liquidity
     * to be swapped, it then proceeds with the swap using the current tick's liquidity.
     *
     * If the current tick is fully consumed, the function returns the remaining amount of the input asset, which will be
     * handled by the `Pool` by moving to the next available tick.
     *
     * @param args The swap arguments, including the direction and input quantity.
     * @returns The result of the swap, including the output quantity and any remaining input quantity.
     */
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

            if (this.currentInventory === 0)
                return { qtyOut: inventoryOut, reminderIn: reminderReserveIn };

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

        if (this.currentReserve === 0)
            return { qtyOut: 0, reminderIn: args.qtyIn };

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

    /**
     * Deposits reserve into the current tick.
     * This is typically called when new liquidity is added to the AMM.
     * @param reserve The amount of reserve to deposit.
     */
    public deposit(reserve: number) {
        this.targetReserve += reserve;
        this.currentReserve += reserve;

        this.targetInventory = this.targetReserve * this.idx.getPrice();
    }

    /**
     * Withdraws a portion of the liquidity from the current tick.
     * This is called when a user withdraws their liquidity from the AMM.
     * @param cut The percentage of liquidity to withdraw (0 to 1).
     * @returns The amount of reserve and inventory withdrawn.
     */
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

    /**
     * Returns a clone of the current tick index.
     * @returns The cloned tick index.
     */
    public index(): TickIndex {
        return this.idx.clone();
    }

    /**
     * Checks if there is any reserve in the current tick.
     * @returns `true` if there is reserve, `false` otherwise.
     */
    public hasReserve() {
        return this.currentReserve > 0;
    }

    /**
     * Checks if there is any inventory in the current tick.
     * @returns `true` if there is inventory, `false` otherwise.
     */
    public hasInventory() {
        return this.currentInventory > 0;
    }

    /**
     * Moves to the next tick.
     * If the current tick's inventory is exhausted, the remaining reserve is moved to the general reserve
     * and the AMM attempts to load the next inventory tick.
     */
    public increment() {
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

            const inventoryTick = this.inventory.takeBest(this.idx.clone());
            if (inventoryTick) this.putInventoryTick(inventoryTick);
        } else {
            panic("There is still some inventory left");
        }
    }

    /**
     * Moves to the previous tick.
     * If the current tick's reserve is exhausted, the remaining inventory is moved to the general inventory
     * and the AMM attempts to load the next reserve tick.
     */
    public decrement() {
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
            if (reserveTick) this.putReserveTick(reserveTick);
        } else {
            panic("There is still some reserve left");
        }
    }

    /**
     * Resets the state of the current tick.
     * This is called when moving to a new tick.
     */
    private cleanup() {
        this.targetInventory = 0;
        this.targetReserve = 0;
        this.currentInventory = 0;
        this.currentReserve = 0;
    }

    /**
     * Puts an inventory tick into the current tick.
     * This is called when a new inventory tick is loaded.
     * @param tick The inventory tick to put.
     */
    private putInventoryTick(tick: InventoryTick) {
        if (tick.idx !== this.idx) panic("Ticks don't match");

        this.targetInventory += tick.inventory;
        this.currentInventory += tick.inventory;

        this.targetReserve = this.targetInventory / this.idx.getPrice();
    }

    /**
     * Puts a reserve tick into the current tick.
     * This is called when a new reserve tick is loaded.
     * @param tick The reserve tick to put.
     */
    private putReserveTick(tick: ReserveTick) {
        if (tick.idx !== this.idx) panic("Ticks don't match");

        this.targetReserve += tick.reserve;
        this.currentReserve += tick.reserve;

        this.targetInventory = this.targetReserve * this.idx.getPrice();
    }

    /**
     * Creates a new `CurrentTick`.
     * @param idx The index of the current tick.
     * @param reserve The AMM's reserve.
     * @param inventory The AMM's inventory.
     */
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

/**
 * The `RecoveryBin` is a mechanism to mitigate impermanent loss (IL).
 * It accumulates fees (collateral) and uses them to buy back the inventory asset at a better price,
 * effectively recovering the value lost due to price changes.
 */
export class RecoveryBin {
    private collateral: number = 0;
    private worstTick: InventoryTick | undefined = undefined;

    /**
     * Withdraws a portion of the collateral and the worst tick inventory.
     * This is called when a user withdraws their liquidity from the AMM.
     * @param cut The percentage of liquidity to withdraw (0 to 1).
     * @returns The amount of inventory withdrawn from the recovery bin.
     */
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

    /**
     * Attempts to recover impermanent loss by using the accumulated fees (collateral)
     * to buy back a portion of the inventory from the worst tick.
     *
     * The formula `dI = min(I, X*P1 / |P1-P0|)` calculates the amount of inventory (`dI`) that can be recovered
     * at the current price (`P1`) using the available collateral (`X`) and the price of the worst tick (`P0`).
     *
     * @param args The recovery arguments, including the amount of reserve being swapped in and the current tick index.
     * @returns The result of the recovery, including the amount of inventory recovered and any remaining reserve.
     */
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

    /**
     * Adds collateral (fees) to the recovery bin.
     * @param fees The amount of fees to add.
     */
    public addCollateral(fees: number) {
        this.collateral += fees;
    }

    /**
     * Checks if there is any collateral in the recovery bin.
     * @returns `true` if there is collateral, `false` otherwise.
     */
    public hasCollateral(): boolean {
        return this.collateral > 0;
    }

    /**
     * Creates a new `RecoveryBin`.
     * @param reserve The AMM's reserve.
     * @param inventory The AMM's inventory.
     */
    constructor(private reserve: Reserve, private inventory: Inventory) {}
}
