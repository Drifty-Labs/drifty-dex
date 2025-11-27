import { CurrentTick } from "./cur-tick.ts";
import { Liquidity, type WithdrawResult } from "./liquidity.ts";
import type { TakeResult } from "./range.ts";
import { TickIndex } from "./ticks.ts";
import { almostEq, panic } from "./utils.ts";

/**
 * Arguments for depositing liquidity into an AMM.
 */
export type DepositArgs = {
    /** The amount of reserve to deposit. */
    reserve: number;
    /**
     * Optional left bound for the reserve range.
     * If provided, it overrides the default behavior (min tick).
     */
    leftBound?: TickIndex;
};

/**
 * Arguments for withdrawing liquidity from an AMM.
 */
export type WithdrawArgs = {
    /**
     * The amount of deposited reserve to withdraw.
     * Should be the same as was really deposited.
     */
    depositedReserve: number;
};

/**
 * Total liquidity of the AMM
 */
export type LiquidityDigest = {
    curTick: {
        idx: TickIndex;
        reserve: number;
        inventory: number;
    };
    recoveryBin: {
        collateral: number;
        worstTick?: TakeResult;
    };
    reserve: TakeResult[];
    inventory: TakeResult[];
};

/**
 * Represents one side of the pool (either base or quote) and encapsulates reserve
 * management, concentrated inventory created by swaps, and IL recovery duties.
 *
 * ### Stable vs drifting behavior
 * Stable AMMs are expected to initialize their reserve range once and keep the
 * left bound at {@link MIN_TICK}. Drifting AMMs are coordinated externally so
 * their reserve window always spans from the current tick back to the opposite
 * side’s worst inventory tick. That policy guarantees that one of the sides
 * always has liquidity covering any price path while the other side gradually
 * sheds IL.
 *
 * ### Responsibilities
 * - Track the total deposited reserve so proportional withdrawals remain fair.
 * - Split deposits between the long-lived reserve range and the currently active
 *   tick, ensuring the live tick always has funds to serve swaps.
 * - Push swap-generated inventory into {@link Inventory} ranges and keep
 *   {@link CurrentTick} in sync.
 * - During withdrawals, convert the worst underwater ticks back into reserve so
 *   early exiters pay the highest IL cost.
 */
export class AMM {
    private depositedReserve: number = 0;
    private liquidity: Liquidity;
    private currentTick: CurrentTick;

    public clone() {
        const a = new AMM(this.currentTick.index.clone());

        a.depositedReserve = this.depositedReserve;
        a.liquidity = this.liquidity.clone();
        a.currentTick = this.currentTick.clone(a.liquidity);

        return a;
    }

    /**
     * Deposits liquidity into the AMM.
     *
     * - The very first deposit bootstraps the reserve range to span from
     *   {@link TickIndex.min} up to the current tick (stable AMM behavior) or an
     *   externally supplied drifting window.
     * - Subsequent deposits split `args.reserve` across the long-lived reserve
     *   range and the current tick so the live tick always gets one extra slice
     *   of liquidity (`fullWidth = reserve.width + 1`).
     * - Every deposit notifies the inventory book that a fresh reserve baseline
     *   exists, so new swap inventory spawns new {@link InventoryRange}s.
     */
    public deposit(args: DepositArgs): void {
        if (!this.liquidity.getReserve().isInitted()) {
            const curTick = this.currentTick.index;
            const leftBound = args.leftBound || curTick.min();

            const rightBound = curTick.clone();
            rightBound.dec();

            const fullWidth = leftBound.distance(rightBound) + 2;

            const addToReserve = (args.reserve * (fullWidth - 1)) / fullWidth;
            const addToCurTick = args.reserve - addToReserve;

            this.liquidity
                .getReserve()
                .init(addToReserve, leftBound, rightBound);
            this.curTick.deposit(addToCurTick);
        } else {
            const fullWidth = this.liquidity.getReserve().width + 1;
            const addToReserve = (args.reserve * (fullWidth - 1)) / fullWidth;
            const addToCurTick = args.reserve - addToReserve;

            this.liquidity.getReserve().putUniform(addToReserve);
            this.currentTick.deposit(addToCurTick);
        }

        this.liquidity.getInventory().notifyReserveChanged();
        this.depositedReserve += args.reserve;
    }

    /**
     * Withdraws a user's liquidity from the AMM.
     *
     * The `cut` reflects how much of the total deposited reserve the caller owns.
     * That same ratio is removed from the long-lived reserve, the current tick,
     * and the outstanding inventory.
     *
     * After draining the live tick, the method walks inventory **backwards**
     * (from worst tick to best) converting it back into reserve-equivalent value.
     * This design intentionally punishes early exiters (they crystallize the most
     * IL) and caps the number of ticks a withdrawal needs to inspect, matching
     * swap complexity.
     */
    public withdraw(args: WithdrawArgs): WithdrawResult {
        const cut = args.depositedReserve / this.depositedReserve;
        let reserve = 0;
        let inventory = 0;

        if (this.liquidity.getReserve().isInitted()) {
            reserve += this.liquidity.getReserve().withdrawCut(cut);
            this.liquidity.getInventory().notifyReserveChanged();
        }

        if (this.currentTick) {
            const { reserve: r, inventory: i } =
                this.currentTick.withdrawCut(cut);
            reserve += r;
            inventory += i;
        }

        if (!this.liquidity.getInventory().isEmpty()) {
            let respectiveReserve =
                this.liquidity.getInventory().respectiveReserve * cut;

            // swapping backwards, which makes early leavers get a worse return, but resolves the IL faster and has better performance

            while (!almostEq(respectiveReserve, 0)) {
                const worstTick = this.liquidity.getInventory().takeRight();
                if (!worstTick) panic("Worst tick should exist");

                const worstTickRespectiveReserve =
                    worstTick.inventory / worstTick.idx.price;

                if (worstTickRespectiveReserve >= respectiveReserve) {
                    const takeInventory =
                        respectiveReserve * worstTick.idx.price;
                    worstTick.inventory -= takeInventory;

                    if (!almostEq(worstTick.inventory, 0)) {
                        this.liquidity
                            .getInventory()
                            .putRightNewRange(worstTick);
                    }

                    inventory += takeInventory;

                    break;
                }

                inventory += worstTick.inventory;
                respectiveReserve -= worstTickRespectiveReserve;

                if (
                    !almostEq(respectiveReserve, 0) &&
                    this.liquidity.getInventory().isEmpty()
                ) {
                    panic(
                        `Still missing ${respectiveReserve} respective reserve, but the inventory is empty`
                    );
                }
            }
        }

        this.depositedReserve -= args.depositedReserve;

        return { reserve, inventory };
    }

    /**
     * Rebases the AMM's reserve range to a new left bound based on the target.
     * Drifts logarithmically: newLeft = currentLeft + (targetLeft - currentLeft) / 2.
     * @param targetLeft The target left bound (e.g. opposite worst inventory tick).
     */
    public drift(targetLeft: TickIndex) {
        if (!this.liquidity.getReserve().isInitted()) return;

        this.liquidity.driftReserve(targetLeft);
    }

    /**
     * Exposes the mutable {@link CurrentTick}. External orchestrators use this to
     * coordinate swaps and, for drifting AMMs, to enforce the moving window
     * policy.
     */
    public get curTick(): CurrentTick {
        return this.currentTick;
    }

    /**
     * Gets the worst (lowest price) inventory tick from the AMM.
     * @returns The worst inventory tick, or `undefined` if the inventory is empty.
     */
    public getRightInventoryTick() {
        return this.liquidity.getInventory().peekRight();
    }

    public getLeftInventoryTick() {
        return this.liquidity.getInventory().peekLeft();
    }

    public getLiquidityDigest(tickSpan: number): LiquidityDigest {
        const wt = this.currentTick.getRecoveryBin().getWorstTick();

        return {
            curTick: {
                idx: this.currentTick.index,
                ...this.currentTick.getLiquidity(),
            },
            recoveryBin: {
                collateral: this.currentTick.getRecoveryBin().getCollateral(),
                worstTick: wt
                    ? { qty: wt.inventory, tickIdx: wt.idx }
                    : undefined,
            },
            reserve: this.liquidity
                .getReserve()
                .unpack(this.curTick.index.clone(), tickSpan),
            inventory: this.liquidity
                .getInventory()
                .unpack(this.curTick.index.clone(), tickSpan),
        };
    }

    /**
     * Calculates the impermanent loss (IL) of the AMM.
     * IL is the difference between the value of the assets held in the AMM and the value of the assets if they were held in a wallet.
     * @returns The impermanent loss as a percentage (0 to 1).
     */
    public get il(): number {
        if (almostEq(this.liquidity.getInventory().qty, 0)) {
            return 0;
        }

        const actualReserve =
            this.liquidity.getInventory().qty / this.curTick.index.price;

        const respectiveReserve =
            this.liquidity.getInventory().respectiveReserve;

        // FIXME: for some reason this one is always negative
        // FIXME: this also should be calculated with the whole reserve in mind
        return Math.abs(1 - actualReserve / respectiveReserve);
    }

    /**
     * Gets the total amount of reserve deposited in the AMM.
     * @returns The total deposited reserve.
     */
    public getDepositedReserve(): number {
        return this.depositedReserve;
    }

    /**
     * Creates a new AMM bound to a starting tick index. The tick orientation is
     * already encoded inside {@link TickIndex} so the same code path works for
     * base and quote sides.
     */
    constructor(
        curTickIdx: TickIndex,
        args?: {
            reserveQty: number;
            inventoryQty: number;
            tickSpan: number;
        }
    ) {
        this.liquidity = new Liquidity();
        this.currentTick = new CurrentTick(curTickIdx.clone(), this.liquidity);

        if (args) {
            const fullWidth = args.tickSpan + 1;
            const addToReserve = (args.reserveQty * args.tickSpan) / fullWidth;
            const addToCurTick = args.reserveQty - addToReserve;

            const respectiveReserve = this.liquidity.init(
                addToReserve,
                args.inventoryQty,
                curTickIdx,
                args.tickSpan
            );
            this.depositedReserve = args.reserveQty + respectiveReserve;

            this.currentTick.deposit(addToCurTick);
        }
    }
}
