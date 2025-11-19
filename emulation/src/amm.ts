import { CurrentTick } from "./cur-tick.ts";
import { Inventory, Reserve } from "./liquidity.ts";
import { TickIndex } from "./ticks.ts";
import { panic } from "./utils.ts";

/**
 * Arguments for depositing liquidity into an AMM.
 */
export type DepositArgs = {
    /** The amount of reserve to deposit. */
    reserve: number;
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
 * The result of a withdrawal operation.
 */
export type WithdrawResult = {
    /** The amount of reserve withdrawn. */
    reserve: number;
    /** The amount of inventory withdrawn. */
    inventory: number;
};

/**
 * Represents an Automated Market Maker (AMM).
 * Each AMM is responsible for managing a single asset, holding a reserve of the asset and an inventory of the other asset in the pair.
 * It processes deposits, withdrawals, and swaps, and tracks and recovers impermanent loss.
 */
export class AMM {
    private depositedReserve: number = 0;
    private reserve: Reserve = new Reserve();
    private inventory: Inventory = new Inventory();
    private currentTick: CurrentTick;

    /**
     * Calculates the impermanent loss (IL) of the AMM.
     * IL is the difference between the value of the assets held in the AMM and the value of the assets if they were held in a wallet.
     * @returns The impermanent loss as a percentage (0 to 1).
     */
    public getIl(): number {
        const actualReserve =
            this.inventory.qty() / this.curTick().index().getPrice();
        const respectiveReserve = this.inventory.getRespectiveReserve();

        if (actualReserve > respectiveReserve)
            panic(
                "Actual reserve should always be smaller than the expected reserve"
            );

        return 1 - actualReserve / respectiveReserve;
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
     * This function allows a user to deposit their reserve assets into the AMM.
     * If the reserve is not yet initialized (i.e., this is the first deposit),
     * the entire amount is deposited into the current tick.
     *
     * If the reserve has been initialized, the deposited amount is split proportionally
     * between the existing reserve range and the current tick. This ensures that the
     * liquidity is distributed across the active trading range.
     *
     * If the reserve has been initialized, the deposited amount is split proportionally
     * between the existing reserve range and the current tick. This ensures that the
     * liquidity is distributed across the active trading range.
     *
     * @param args An object containing the amount of reserve to deposit.
     */
    public deposit(args: DepositArgs): void {
        if (!this.reserve.isInitted()) {
            const curTick = this.currentTick.index();

            this.reserve.init(args.reserve, curTick.min(), curTick.clone());
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
     * This function calculates the user's share of the total liquidity based on their deposited reserve.
     * It then withdraws the corresponding amounts from the reserve and the current tick.
     *
     * A key part of this function is handling the withdrawal of inventory that has been affected by impermanent loss.
     * To minimize the impact of IL, the function identify the inventory at the worst (least profitable) ticks
     * and swaps it back to the reserve asset. This "backward swapping" strategy aims to improve the returns
     * for users who withdraw their liquidity, especially in volatile market conditions.
     *
     * FIXME: this is simply wrong. the withdrawal is made backwards to enable two things:
     * 1. punish early leavers - they take the most IL with them, improving the IL for everybody else
     * 2. make withdrawals the same performance as a swap, because now withdrawals have to only iterate through a specific number of ticks LESS than total inventory ticks.
     *
     * @param args An object containing the amount of deposited reserve to withdraw.
     * @returns An object containing the amounts of reserve and inventory withdrawn.
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

                const worstTickRespectiveReserve =
                    worstTick.inventory / worstTick.idx.getPrice();

                if (worstTickRespectiveReserve >= respectiveReserve) {
                    const takeInventory =
                        respectiveReserve * worstTick.idx.getPrice();

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
     * Gets the current tick of the AMM.
     * @returns The current tick.
     */
    public curTick(): CurrentTick {
        return this.currentTick;
    }

    /**
     * Creates a new AMM.
     * @param curTickIdx The initial tick index.
     */
    constructor(curTickIdx: TickIndex) {
        this.currentTick = new CurrentTick(
            curTickIdx,
            this.reserve,
            this.inventory
        );
    }
}
