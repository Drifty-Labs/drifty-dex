import { CurrentTick } from "./cur-tick.ts";
import { Inventory, Reserve, type WithdrawResult } from "./liquidity.ts";
import type { TakeResult } from "./range.ts";
import { TickIndex } from "./ticks.ts";
import { panic } from "./utils.ts";

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
export type Liquidity = {
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
    private reserve: Reserve = new Reserve();
    private inventory: Inventory = new Inventory();
    private currentTick: CurrentTick;

    public getLiquidity(tickSpan: number): Liquidity {
        const wt = this.currentTick.getRecoveryBin().getWorstTick();

        return {
            curTick: {
                idx: this.currentTick.index(),
                ...this.currentTick.getLiquidity(),
            },
            recoveryBin: {
                collateral: this.currentTick.getRecoveryBin().getCollateral(),
                worstTick: wt
                    ? { qty: wt.inventory, tickIdx: wt.idx }
                    : undefined,
            },
            reserve: this.reserve.unpack(
                this.curTick().index().clone(),
                tickSpan
            ),
            inventory: this.inventory.unpack(
                this.curTick().index().clone(),
                tickSpan
            ),
        };
    }

    /**
     * Calculates the impermanent loss (IL) of the AMM.
     * IL is the difference between the value of the assets held in the AMM and the value of the assets if they were held in a wallet.
     * @returns The impermanent loss as a percentage (0 to 1).
     */
    public getIl(): number {
        let actualReserve = 0;
        if (this.curTick().index().isInv()) {
            actualReserve =
                this.inventory.qty() / this.curTick().index().getPrice();
        } else {
            actualReserve =
                this.inventory.qty() * this.curTick().index().getPrice();
        }
        const respectiveReserve = this.inventory.getRespectiveReserve();

        if (this.inventory.qty() === 0) {
            return 0;
        }

        if (respectiveReserve === 0) return 0;

        return 1 - actualReserve / respectiveReserve;
    }

    public getLiquidityRanges() {
        return {
            reserve: this.reserve.getRanges(),
            inventory: this.inventory.getRanges(),
        };
    }

    /**
     * Gets the total amount of reserve deposited in the AMM.
     * @returns The total deposited reserve.
     */
    public getDepositedReserve(): number {
        return this.depositedReserve;
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
        if (!this.reserve.isInitted()) {
            const curTick = this.currentTick.index();
            const leftBound = args.leftBound || curTick.min();

            const rightBound = curTick.clone();
            rightBound.dec();

            this.reserve.init(args.reserve, leftBound, rightBound);
        } else {
            const fullWidth = this.reserve.width + 1;
            const addToReserve =
                (args.reserve * this.reserve.width) / fullWidth;
            const addToCurTick = args.reserve - addToReserve;

            this.reserve.put(addToReserve);
            this.inventory.notifyReserveChanged();

            this.currentTick.deposit(addToCurTick);
        }

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

        if (this.reserve.isInitted()) {
            reserve += this.reserve.withdrawCut(cut);
            this.inventory.notifyReserveChanged();
        }

        if (this.currentTick) {
            const { reserve: r, inventory: i } =
                this.currentTick.withdrawCut(cut);
            reserve += r;
            inventory += i;
        }

        if (!this.inventory.isEmpty()) {
            let respectiveReserve = this.inventory.getRespectiveReserve() * cut;

            // swapping backwards, which makes early leavers get a worse return, but resolves the IL faster and has better performance

            while (respectiveReserve > 0) {
                const worstTick = this.inventory.takeWorst();
                if (!worstTick) panic("Worst tick should exist");

                if (!worstTick) panic("Worst tick should exist");

                let worstTickRespectiveReserve = 0;
                if (worstTick.idx.isInv()) {
                    worstTickRespectiveReserve =
                        worstTick.inventory / worstTick.idx.getPrice();
                } else {
                    worstTickRespectiveReserve =
                        worstTick.inventory * worstTick.idx.getPrice();
                }

                if (worstTickRespectiveReserve >= respectiveReserve) {
                    let takeInventory = 0;
                    if (worstTick.idx.isInv()) {
                        takeInventory =
                            respectiveReserve / worstTick.idx.getPrice();
                    } else {
                        takeInventory =
                            respectiveReserve * worstTick.idx.getPrice();
                    }

                    worstTick.inventory -= takeInventory;

                    if (worstTick.inventory > 0) {
                        this.inventory.putWorstNewRange(worstTick);
                    }

                    inventory += takeInventory;

                    break;
                }

                inventory += worstTick.inventory;
                respectiveReserve -= worstTickRespectiveReserve;

                if (respectiveReserve > 0 && this.inventory.isEmpty()) {
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
     * Exposes the mutable {@link CurrentTick}. External orchestrators use this to
     * coordinate swaps and, for drifting AMMs, to enforce the moving window
     * policy.
     */
    public curTick(): CurrentTick {
        return this.currentTick;
    }

    /**
     * Gets the worst (lowest price) inventory tick from the AMM.
     * @returns The worst inventory tick, or `undefined` if the inventory is empty.
     */
    public getWorstInventoryTick() {
        return this.inventory.peekWorst();
    }

    /**
     * Rebases the AMM's reserve range to a new left bound based on the target.
     * Drifts logarithmically: newLeft = currentLeft + (targetLeft - currentLeft) / 2.
     * @param targetLeft The target left bound (e.g. opposite worst inventory tick).
     */
    public rebase(targetLeft: TickIndex) {
        if (!this.reserve.isInitted()) return;

        const currentLeft = this.reserve.getLeft();

        // If target is to the left of current, we don't drift back (we only concentrate)
        // Or do we? The requirement says "drifting AMM is expected to follow the rules... left bound equals opposite worst inventory tick"
        // But the user said "drifting logarithmically - halving the distance".
        // Usually drifting means moving towards the price (concentrating).
        // If the opposite inventory moves away (e.g. price moves away), should we expand?
        // "RecoveryBin-first swap logic... immediately uses fees and deepest underwater ticks to heal IL."
        // Drifting is about "concentrating liquidity (drifting) where it’s most useful."
        // So it should likely only move forward (towards price).
        // But let's stick to the formula: halve the distance.

        // If targetLeft > currentLeft (target is to the right, closer to price), we move right.
        // If targetLeft < currentLeft (target is to the left, further from price), we move left?
        // "concentrating liquidity" implies narrowing the range.
        // If we move left, we widen the range (assuming right bound is fixed at current tick).
        // Wait, right bound is fixed at current tick?
        // "reserve window always spans from the current tick back to the opposite side’s worst inventory tick"
        // So if opposite worst inventory tick moves left (more IL), we should expand?
        // User said: "halving the distance between out worst reserve tick and the opposite worst inventory tick."
        // So we just move towards the target.

        const distance = currentLeft.distance(targetLeft);
        if (distance === 0) return;

        const moveBy = Math.floor(distance / 2);
        if (moveBy === 0) return;

        const newLeft = currentLeft.clone();
        if (targetLeft.gt(currentLeft)) {
            newLeft.add(moveBy);
        } else {
            newLeft.add(-moveBy);
        }

        this.reserve.rebase(newLeft);
    }

    /**
     * Creates a new AMM bound to a starting tick index. The tick orientation is
     * already encoded inside {@link TickIndex} so the same code path works for
     * base and quote sides.
     */
    constructor(curTickIdx: TickIndex) {
        this.currentTick = new CurrentTick(
            curTickIdx.clone(),
            this.reserve,
            this.inventory
        );
    }
}
