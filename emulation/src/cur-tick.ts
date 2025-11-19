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
 * Captures the state of the currently active tick for a single AMM side.
 *
 * It is the only mutable location that swaps touch directly. All other ticks
 * live either in the {@link Reserve} (to the left of price) or {@link Inventory}
 * (to the right of price). As swaps consume one side, {@link CurrentTick}
 * requests a fresh chunk from the respective structure and advances the tick
 * index.
 *
 * The class also hosts the {@link RecoveryBin} responsible for fee-funded IL
 * recovery before regular inventory is touched.
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
     * Steps for `reserve -> inventory`:
     * 1. Let {@link RecoveryBin} try to match the input with the worst underwater
     *    tick plus accumulated collateral.
     * 2. If recovery does not exhaust the input, consume the live inventory and
     *    track how much reserve remains for the outer {@link Pool} loop.
     *
     * For `inventory -> reserve`, only the live reserve is used. Any leftover
     * inventory is bubbled up so the pool can decrement ticks and continue.
     */
    public swap(args: CurrentTickSwapArgs): CurrentTickSwapResult {
        if (args.direction === "reserve -> inventory") {
            // first try to recover as much IL as possible
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
     * Deposits reserve into the current tick and recomputes the target
     * inventory value the tick wants to hold to remain balanced.
     */
    public deposit(reserve: number) {
        this.targetReserve += reserve;
        this.currentReserve += reserve;

        this.targetInventory = this.targetReserve * this.idx.getPrice();
    }

    /**
     * Withdraws a proportional slice of the tick’s reserve/inventory plus the
     * recovery bin collateral.
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

    public hasInventory() {
        return this.currentInventory > 0;
    }

    /**
     * Moves to the next tick when inventory is exhausted. Any leftover reserve
     * is pushed back into the global reserve book before requesting the next
     * best inventory tick.
     * @param direction The swap direction for this AMM (context for validation)
     */
    public increment(direction: AMMSwapDirection) {
        // Moving RIGHT (towards inventory)
        // If we're selling reserve (reserve -> inventory), we're moving away from reserve
        // We should have consumed inventory at current tick first
        if (direction === "reserve -> inventory" && this.currentInventory > 0) {
            panic("There is still some inventory left - must consume before moving");
        }
        
        // If we're buying reserve (inventory -> reserve), we're moving into inventory
        // We should have consumed reserve at current tick first
        if (direction === "inventory -> reserve" && this.currentReserve > 0) {
            panic("There is still some reserve left - must consume before moving");
        }

        if (this.currentReserve > 0) {
            if (this.currentReserve !== this.targetReserve)
                panic(
                    "Current reserve should match target reserve after tick exhaustion"
                );

            this.reserve.stretchToCurTick(this.idx);
            this.reserve.put(this.currentReserve);
            this.inventory.notifyReserveChanged();
        }

        this.cleanup();
        this.idx.inc();

        const inventoryTick = this.inventory.takeBest(this.idx.clone());
        if (inventoryTick) this.putInventoryTick(inventoryTick);
    }

    /**
     * Checks if this tick has any reserve available.
     * Used to determine when to move ticks during swaps.
     */
    public hasReserve(): boolean {
        return this.currentReserve > 0;
    }

    /**
     * Moves to the previous tick when moving towards reserve.
     * @param direction The swap direction for this AMM (context for validation)
     */
    public decrement(direction: AMMSwapDirection) {
        // Moving LEFT (towards reserve)
        
        // If we're selling reserve (reserve -> inventory), we're consuming INVENTORY
        // We should have consumed inventory at current tick first
        if (direction === "reserve -> inventory" && this.currentInventory > 0) {
            panic("There is still some inventory left - must consume before moving");
        }
        
        // If we're buying reserve (inventory -> reserve), we're consuming RESERVE
        // We should have consumed current reserve before needing more
        if (direction === "inventory -> reserve" && this.currentReserve > 0) {
            panic("There is still some reserve left - must consume before moving");
        }
        
        // Save any remaining inventory (accumulated or unused)
        if (this.currentInventory > 0) {
            this.inventory.putBest({
                idx: this.idx.clone(),
                inventory: this.currentInventory,
            });
        } else {
            this.inventory.notifyReserveChanged();
        }

        // Save any remaining reserve (accumulated)
        // Note: We don't stretchToCurTick because we are moving INTO reserve (left)
        // The reserve range right edge is already at curTick - 1 (or should be)
        // We just put the amount back into the pool
        if (this.currentReserve > 0) {
            this.reserve.put(this.currentReserve);
        }

        this.cleanup();
        this.idx.dec();

        const reserveTick = this.reserve.takeBest();
        if (reserveTick) this.putReserveTick(reserveTick);
    }

    /**
     * Resets the current tick’s accumulators before loading data for the next
     * price level.
     */
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
        if (tick.idx.index() !== this.idx.index()) panic("Ticks don't match");

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

/**
 * Fee-funded IL repair engine that focuses on a single worst tick at a time.
 */
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

    /**
     * Uses collateral + the worst inventory tick to offset fresh reserve inflow.
     *
     * - If no worst tick is cached, it pops one from {@link Inventory.takeWorst}.
     * - If the current price equals the worst tick and there is no collateral,
     *   the tick is returned untouched—the outer swap will sell it normally.
     * - Otherwise it applies `dI = min(I, X*P1 / |P1-P0|)` to determine how
     *   much inventory can be safely recovered right now.
     */
    public recover(args: RecoverArgs): RecoverResult {
        if (!this.worstTick) {
            this.worstTick = this.inventory.takeWorst();
            if (!this.worstTick)
                return {
                    inventoryOut: 0,
                    reminderReserveIn: args.reserveIn,
                    recoveredReserve: 0,
                };
        }

        if (!this.hasCollateral() && this.worstTick.idx.eq(args.curTickIdx)) {
            this.inventory.putWorstNewRange(this.worstTick);
            this.worstTick = undefined;

            return {
                inventoryOut: 0,
                reminderReserveIn: args.reserveIn,
                recoveredReserve: 0,
            };
        }

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
