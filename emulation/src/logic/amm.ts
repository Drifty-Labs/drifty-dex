import { CurrentTick } from "./cur-tick.ts";
import { Liquidity, type WithdrawResult } from "./liquidity.ts";
import type { TakeResult } from "./range.ts";
import { TickIndex } from "./ticks.ts";
import { almostEq, panic, tickToPrice } from "./utils.ts";

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

export class AMM {
    private depositedReserve: number = 0;
    private liquidity: Liquidity;
    private currentTick: CurrentTick;

    public clone() {
        const a = new AMM(this.name, this.currentTick.index.clone());

        a.depositedReserve = this.depositedReserve;
        a.liquidity = this.liquidity.clone();
        a.currentTick = this.currentTick.clone(a.liquidity);

        return a;
    }

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
                    worstTick.inventory *
                    tickToPrice(worstTick.idx, "inventory");

                if (worstTickRespectiveReserve >= respectiveReserve) {
                    const takeInventory =
                        respectiveReserve *
                        tickToPrice(worstTick.idx, "reserve");
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

    public drift(targetLeft: TickIndex) {
        if (!this.liquidity.getReserve().isInitted()) return;

        console.log(`[${this.name}] Drifting to ${targetLeft.toAbsolute()}`);

        this.liquidity.driftReserve(targetLeft);
    }

    public get curTick(): CurrentTick {
        return this.currentTick;
    }

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

    public get il(): number {
        if (almostEq(this.liquidity.getInventory().qty, 0)) {
            return 0;
        }

        const actualReserve =
            this.liquidity.getInventory().qty *
            tickToPrice(this.curTick.index, "inventory");

        const respectiveReserve =
            this.liquidity.getInventory().respectiveReserve;

        // FIXME: for some reason this one is always negative
        // FIXME: this also should be calculated with the whole reserve in mind
        return Math.abs(1 - actualReserve / respectiveReserve);
    }

    public getDepositedReserve(): number {
        return this.depositedReserve;
    }

    public toString() {
        return this.name;
    }

    constructor(
        private name: string,
        curTickIdx: TickIndex,
        args?: {
            reserveQty: number;
            inventoryQty: number;
            tickSpan: number;
        }
    ) {
        this.liquidity = new Liquidity();
        this.currentTick = new CurrentTick(
            this.name,
            curTickIdx.clone(),
            this.liquidity
        );

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
