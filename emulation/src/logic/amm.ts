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
    accountDepositedReserve: boolean;
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
    private _depositedReserve: number = 0;
    private _liquidity: Liquidity;
    private _currentTick: CurrentTick;

    constructor(
        private side: Side,
        private isDrifting: boolean,
        private noLogs: boolean,
        curTickIdx: number,
        args?: {
            reserveQty: number;
            inventoryQty: number;
            tickSpan: number; // (tickSpan + 1) === width
        },
        liquidity?: Liquidity,
        currentTick?: CurrentTick
    ) {
        this._liquidity = liquidity
            ? liquidity
            : new Liquidity(this.side, this.isDrifting, noLogs);
        this._currentTick = currentTick
            ? currentTick
            : new CurrentTick(
                  this.side,
                  this.isDrifting,
                  curTickIdx,
                  this._liquidity,
                  noLogs
              );

        if (args) {
            const respectiveReserve = this._liquidity.init(
                args.reserveQty,
                args.inventoryQty,
                curTickIdx,
                args.tickSpan
            );
            this._depositedReserve = args.reserveQty + respectiveReserve;
        }
    }

    public clone(noLogs: boolean) {
        const liq = this._liquidity.clone(noLogs);
        const ct = this._currentTick.clone(liq, noLogs);

        const a = new AMM(
            this.side,
            this.isDrifting,
            noLogs,
            ct.index,
            undefined,
            liq,
            ct
        );

        a._depositedReserve = this._depositedReserve;

        return a;
    }

    public deposit(args: DepositArgs): void {
        if (!this._liquidity.reserve.isInitted()) {
            const curTick = this._currentTick.index;

            const tickSpan =
                args.tickSpan ??
                (this.isBase()
                    ? MAX_TICK - (curTick + 1)
                    : curTick - 1 - MIN_TICK);

            const leftBound = this.isBase()
                ? curTick + 1
                : curTick - 1 - tickSpan;
            const rightBound = this.isBase()
                ? curTick + 1 + tickSpan
                : curTick - 1;

            this._liquidity.reserve.init(args.reserve, leftBound, rightBound);
        } else {
            this._liquidity.reserve.putUniform(args.reserve);
        }

        this._liquidity.inventory.notifyReserveChanged();

        if (args.accountDepositedReserve) {
            this._depositedReserve += args.reserve;
        }
    }

    public withdraw(args: WithdrawArgs): WithdrawResult {
        const cut = args.depositedReserve / this._depositedReserve;
        let reserve = 0;
        let inventory = 0;

        if (this._liquidity.reserve.isInitted()) {
            reserve += this._liquidity.reserve.withdrawCut(cut);
            this._liquidity.inventory.notifyReserveChanged();
        }

        if (this._currentTick) {
            const { reserve: r, inventory: i } =
                this._currentTick.withdrawCut(cut);
            reserve += r;
            inventory += i;
        }

        if (!this._liquidity.inventory.isEmpty()) {
            let respectiveReserve =
                this._liquidity.inventory.respectiveReserve * cut;

            // swapping backwards, which makes early leavers get a worse return, but resolves the IL faster and has better performance

            while (!almostEq(respectiveReserve, 0)) {
                const worstTick = this._liquidity.inventory.takeWorst();
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
                        this._liquidity.inventory.putWorstNewRange(worstTick);
                    }

                    inventory += takeInventory;

                    break;
                }

                inventory += worstTick.inventory;
                respectiveReserve -= worstTickRespectiveReserve;

                if (
                    !almostEq(respectiveReserve, 0) &&
                    this._liquidity.inventory.isEmpty()
                ) {
                    panic(
                        `Still missing ${respectiveReserve} respective reserve, but the inventory is empty`
                    );
                }
            }
        }

        this._depositedReserve -= args.depositedReserve;

        return { reserve, inventory };
    }

    public drift(targetLeft: number, tickSpan: number) {
        if (!this._liquidity.reserve.isInitted()) return;

        const r = this._liquidity.reserve.getRange();
        if (!r) {
            this._liquidity.driftReserve(targetLeft);
            return;
        }

        const { left, right } = r;
        if (left === targetLeft) return;
        if (right - targetLeft + 1 < tickSpan) return;

        /*        console.log(
            "Drifting",
            this.side,
            [left, right],
            this._liquidity.reserve.getRange()?.width,
            targetLeft,
            tickSpan
        );
 */
        this._liquidity.driftReserve(targetLeft);
    }

    public get currentTick(): CurrentTick {
        return this._currentTick;
    }

    public get worstInventoryTick() {
        return this._liquidity.inventory.peekWorst();
    }

    public get bestInventoryTick() {
        return this._liquidity.inventory.peekBest();
    }

    public get liquidityDigest(): LiquidityDigest {
        return {
            curTick: {
                idx: this._currentTick.index,
                ...this._currentTick.getLiquidity(),
            },
            recoveryBin: {
                collateral: this._currentTick.getRecoveryBin().collateral,
            },
            reserve: this._liquidity.reserve.getRange(),
            inventory: this._liquidity.inventory.getRanges(),
        };
    }

    public get il(): number {
        if (almostEq(this._liquidity.inventory.qty, 0)) {
            return 0;
        }

        const leftoverReserve = this._liquidity.reserve.qty;

        const expectedReserve =
            this._liquidity.inventory.qty *
            absoluteTickToPrice(this.currentTick.index, this.side, "inventory");

        const respectiveReserve = this._liquidity.inventory.respectiveReserve;

        const i = 1 - expectedReserve / respectiveReserve;
        if (i < 0 || i > 1) {
            console.error("Invalid IL", i, this.clone(this.noLogs));
        }

        return (
            1 -
            (expectedReserve + leftoverReserve) /
                (respectiveReserve + leftoverReserve)
        );
    }

    public get depositedReserve(): number {
        return this._depositedReserve;
    }

    public get actualReserve(): number {
        return (
            this._liquidity.reserve.qty +
            this.currentTick.getLiquidity().reserve
        );
    }

    public get actualInventory(): number {
        return (
            this._liquidity.inventory.qty +
            this.currentTick.getLiquidity().inventory +
            this.currentTick.getRecoveryBin().collateral
        );
    }

    public get respectiveReserve(): number {
        return (
            this._liquidity.inventory.respectiveReserve +
            this.currentTick.getLiquidity().inventory *
                absoluteTickToPrice(
                    this.currentTick.index,
                    this.side,
                    "inventory"
                )
        );
    }

    public isBase() {
        return this.side === "base";
    }
}
