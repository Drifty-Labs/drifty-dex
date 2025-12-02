import { CurrentTick } from "./cur-tick.ts";
import { Liquidity, type WithdrawResult } from "./liquidity.ts";
import type { InventoryRange, ReserveRange, TakeResult } from "./range.ts";
import {
    absoluteTickToPrice,
    almostEq,
    MAX_TICK,
    MIN_TICK,
    panic,
    type Side,
} from "./utils.ts";

/**
 * Arguments for depositing liquidity into an AMM.
 */
export type DepositArgs = {
    /** The amount of reserve to deposit. */
    reserve: number;
    tickSpan?: number;
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
        idx: number;
        reserve: number;
        inventory: number;
    };
    recoveryBin: {
        collateral: number;
        worstTick?: TakeResult;
    };
    reserve?: ReserveRange;
    inventory: InventoryRange[];
};

export class AMM {
    private depositedReserve: number = 0;
    private liquidity: Liquidity;
    private currentTick: CurrentTick;

    constructor(
        private side: Side,
        curTickIdx: number,
        args?: {
            reserveQty: number;
            inventoryQty: number;
            tickSpan: number; // (tickSpan + 1) === width
        },
        liquidity?: Liquidity,
        currentTick?: CurrentTick
    ) {
        this.liquidity = liquidity ? liquidity : new Liquidity(this.side);
        this.currentTick = currentTick
            ? currentTick
            : new CurrentTick(this.side, curTickIdx, this.liquidity);

        if (args) {
            const addToReserve =
                (args.reserveQty * (args.tickSpan + 1)) / (args.tickSpan + 2);
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

    public clone() {
        const liq = this.liquidity.clone();
        const ct = this.currentTick.clone(liq);

        const a = new AMM(this.side, ct.index, undefined, liq, ct);

        a.depositedReserve = this.depositedReserve;

        return a;
    }

    public deposit(args: DepositArgs): void {
        if (!this.liquidity.reserve.isInitted()) {
            const curTick = this.currentTick.index;

            const tickSpan =
                args.tickSpan ?? this.isBase()
                    ? MAX_TICK - (curTick + 1)
                    : curTick - 1 - MIN_TICK;

            const addToReserve =
                (args.reserve * (tickSpan + 1)) / (tickSpan + 2);
            const addToCurTick = args.reserve - addToReserve;

            const leftBound = this.isBase()
                ? curTick + 1
                : curTick - 1 - tickSpan;
            const rightBound = this.isBase()
                ? curTick + 1 + tickSpan
                : curTick - 1;

            this.liquidity.reserve.init(addToReserve, leftBound, rightBound);
            this.curTick.deposit(addToCurTick);
        } else {
            const fullWidth = this.liquidity.reserve.width + 1;
            const addToReserve = (args.reserve * (fullWidth - 1)) / fullWidth;
            const addToCurTick = args.reserve - addToReserve;

            this.liquidity.reserve.putUniform(addToReserve);
            this.currentTick.deposit(addToCurTick);
        }

        this.liquidity.inventory.notifyReserveChanged();
        this.depositedReserve += args.reserve;
    }

    public withdraw(args: WithdrawArgs): WithdrawResult {
        const cut = args.depositedReserve / this.depositedReserve;
        let reserve = 0;
        let inventory = 0;

        if (this.liquidity.reserve.isInitted()) {
            reserve += this.liquidity.reserve.withdrawCut(cut);
            this.liquidity.inventory.notifyReserveChanged();
        }

        if (this.currentTick) {
            const { reserve: r, inventory: i } =
                this.currentTick.withdrawCut(cut);
            reserve += r;
            inventory += i;
        }

        if (!this.liquidity.inventory.isEmpty()) {
            let respectiveReserve =
                this.liquidity.inventory.respectiveReserve * cut;

            // swapping backwards, which makes early leavers get a worse return, but resolves the IL faster and has better performance

            while (!almostEq(respectiveReserve, 0)) {
                const worstTick = this.liquidity.inventory.takeWorst();
                if (!worstTick) panic("Worst tick should exist");

                const worstTickRespectiveReserve =
                    worstTick.inventory *
                    absoluteTickToPrice(worstTick.idx, this.side, "inventory");

                if (worstTickRespectiveReserve >= respectiveReserve) {
                    const takeInventory =
                        respectiveReserve *
                        absoluteTickToPrice(
                            worstTick.idx,
                            this.side,
                            "reserve"
                        );
                    worstTick.inventory -= takeInventory;

                    if (!almostEq(worstTick.inventory, 0)) {
                        this.liquidity.inventory.putWorstNewRange(worstTick);
                    }

                    inventory += takeInventory;

                    break;
                }

                inventory += worstTick.inventory;
                respectiveReserve -= worstTickRespectiveReserve;

                if (
                    !almostEq(respectiveReserve, 0) &&
                    this.liquidity.inventory.isEmpty()
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

    public drift(targetLeft: number) {
        if (!this.liquidity.reserve.isInitted()) return;
        if (this.liquidity.reserve.peekWorst()?.idx === targetLeft) return;

        this.liquidity.driftReserve(targetLeft);
    }

    public get curTick(): CurrentTick {
        return this.currentTick;
    }

    public getRightInventoryTick() {
        return this.liquidity.inventory.peekWorst();
    }

    public getLeftInventoryTick() {
        return this.liquidity.inventory.peekBest();
    }

    public getLiquidityDigest(): LiquidityDigest {
        const wt = this.currentTick.getRecoveryBin().worstTick;

        return {
            curTick: {
                idx: this.currentTick.index,
                ...this.currentTick.getLiquidity(),
            },
            recoveryBin: {
                collateral: this.currentTick.getRecoveryBin().collateral,
                worstTick: wt
                    ? { qty: wt.inventory, tickIdx: wt.idx }
                    : undefined,
            },
            reserve: this.liquidity.reserve.getRange(),
            inventory: this.liquidity.inventory.getRanges(),
        };
    }

    public get il(): number {
        if (almostEq(this.liquidity.inventory.qty, 0)) {
            return 0;
        }

        const actualReserve =
            this.liquidity.inventory.qty *
            absoluteTickToPrice(this.curTick.index, this.side, "inventory");

        const respectiveReserve = this.liquidity.inventory.respectiveReserve;

        // FIXME: for some reason this one is always negative
        // FIXME: this also should be calculated with the whole reserve in mind
        return Math.abs(1 - actualReserve / respectiveReserve);
    }

    public getDepositedReserve(): number {
        return this.depositedReserve;
    }

    public getActualReserve(): number {
        return this.liquidity.reserve.qty + this.curTick.getLiquidity().reserve;
    }

    public getActualInventory(): number {
        return (
            this.liquidity.inventory.qty + this.curTick.getLiquidity().inventory
        );
    }

    public getRespectiveReserve(): number {
        return (
            this.liquidity.inventory.respectiveReserve +
            this.curTick.getLiquidity().inventory *
                absoluteTickToPrice(this.curTick.index, this.side, "inventory")
        );
    }

    public isBase() {
        return this.side === "base";
    }
}
