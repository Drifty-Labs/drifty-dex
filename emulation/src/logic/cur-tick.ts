import {
    type InventoryTick,
    Liquidity,
    type ReserveTick,
    type WithdrawResult,
} from "./liquidity.ts";
import { TickIndex } from "./ticks.ts";
import { almostEq, panic, tickToPrice } from "./utils.ts";

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
        private name: string,
        private idx: TickIndex,
        private liquidity: Liquidity
    ) {
        this.recoveryBin = new RecoveryBin(name, liquidity);
    }

    public clone(newLiquidity: Liquidity) {
        const c = new CurrentTick(this.name, this.idx.clone(), newLiquidity);

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
                    curTickIdx: this.idx.clone(),
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
                reminderReserveIn * tickToPrice(this.idx, "reserve");

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
                reminderInventory * tickToPrice(this.idx, "inventory");

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

        const needsReserve = args.qtyIn * tickToPrice(this.idx, "inventory");

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
            reminderReserve * tickToPrice(this.idx, "reserve");

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
                  idx: this.idx.clone(),
                  inventory: this.currentInventory,
              };

        this.cleanup();
        this.idx.dec();

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
            : { idx: this.idx.clone(), reserve: this.currentReserve };

        this.cleanup();
        this.idx.inc();

        const inventoryTick = this.liquidity.obtainInventoryTick(
            reserveTick,
            this.idx.clone()
        );

        if (inventoryTick) this.putInventoryTick(inventoryTick);
    }

    public deposit(reserve: number) {
        this.targetReserve += reserve;
        this.currentReserve += reserve;

        this.targetInventory =
            this.targetReserve * tickToPrice(this.idx, "reserve");
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

    public get index(): TickIndex {
        return this.idx.clone();
    }

    public hasInventory() {
        return this.currentInventory > 0;
    }

    public hasReserve(): boolean {
        return this.currentReserve > 0;
    }

    private cleanup() {
        this.targetInventory = 0;
        this.targetReserve = 0;
        this.currentInventory = 0;
        this.currentReserve = 0;
    }

    private putInventoryTick(tick: InventoryTick) {
        if (!tick.idx.eq(this.idx)) panic("Ticks don't match");

        this.targetInventory += tick.inventory;
        this.currentInventory += tick.inventory;

        this.targetReserve =
            this.targetInventory * tickToPrice(this.idx, "inventory");
    }

    private putReserveTick(tick: ReserveTick) {
        if (tick.idx.index() !== this.idx.index()) panic("Ticks don't match");

        this.targetReserve += tick.reserve;
        this.currentReserve += tick.reserve;

        this.targetInventory =
            this.targetReserve * tickToPrice(this.idx, "reserve");
    }

    public getRecoveryBin() {
        return this.recoveryBin;
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

    constructor(private name: string, private liquidity: Liquidity) {}

    public clone(newLiquidity: Liquidity) {
        const r = new RecoveryBin(this.name, newLiquidity);

        r.collateral = this.collateral;
        r.worstTick = this.worstTick
            ? {
                  idx: this.worstTick.idx.clone(),
                  inventory: this.worstTick.inventory,
              }
            : undefined;

        return r;
    }

    public getWorstTick(): InventoryTick | undefined {
        return this.worstTick;
    }

    public withdrawCut(cut: number): number {
        if (this.worstTick) {
            panic("Worst tick should not be present outside of swaps");
        }

        const collateralToWithdraw = this.collateral * cut;
        this.collateral -= collateralToWithdraw;

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
        const inventory = this.liquidity.getInventory();

        if (almostEq(this.collateral, 0))
            return {
                inventoryOut: 0,
                recoveredReserve: 0,
                reminderReserveIn: args.reserveIn,
            };

        this.worstTick = inventory.takeRight();
        if (!this.worstTick)
            return {
                inventoryOut: 0,
                recoveredReserve: 0,
                reminderReserveIn: args.reserveIn,
            };

        // guarantees no division by zero below
        if (this.worstTick.idx.eq(args.curTickIdx)) {
            this.liquidity.getInventory().putRightNewRange(this.worstTick);
            this.worstTick = undefined;

            return {
                inventoryOut: 0,
                recoveredReserve: 0,
                reminderReserveIn: args.reserveIn,
            };
        }

        // Raw prices for ratio calculations
        const p0 = this.worstTick.idx.price;
        const p1 = args.curTickIdx.price;
        const I = this.worstTick.inventory;
        const X = this.collateral;

        const maxdI = (X * p1) / Math.abs(p1 - p0);
        const dI = Math.min(I, maxdI);

        const hasInventory = this.collateral + dI;
        const needsInventory =
            args.reserveIn * tickToPrice(args.curTickIdx, "reserve");

        if (hasInventory > needsInventory) {
            const leftoverInventory = hasInventory - needsInventory;
            const leftoverCut = leftoverInventory / hasInventory;

            this.collateral *= leftoverCut;
            const leftoverWorstTick = dI * leftoverCut;

            this.worstTick.inventory =
                this.worstTick.inventory - dI + leftoverWorstTick;

            this.liquidity.getInventory().putRightNewRange(this.worstTick);
            this.worstTick = undefined;

            return {
                inventoryOut: needsInventory,
                reminderReserveIn: 0,
                recoveredReserve: args.reserveIn,
            };
        }

        const takeInventory = hasInventory;
        const takeReserve =
            takeInventory * tickToPrice(args.curTickIdx, "inventory");

        this.worstTick.inventory -= dI;

        const dICut = dI / maxdI;
        this.collateral *= 1 - dICut;

        if (almostEq(this.worstTick.inventory, 0)) {
            this.worstTick = undefined;
        } else {
            this.liquidity.getInventory().putRightNewRange(this.worstTick);
            this.worstTick = undefined;
        }

        return {
            inventoryOut: takeInventory,
            reminderReserveIn: args.reserveIn - takeReserve,
            recoveredReserve: takeReserve,
        };
    }

    public unsetWorstTick() {
        this.worstTick = undefined;
    }

    public addCollateral(fees: number) {
        this.collateral += fees;
    }

    public hasCollateral(): boolean {
        return this.collateral > 0;
    }

    public getCollateral(): number {
        return this.collateral;
    }
}
