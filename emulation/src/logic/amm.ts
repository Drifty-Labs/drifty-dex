import { CurrentTick } from "./cur-tick.ts";
import { E8s } from "./ecs.ts";
import { Liquidity, type WithdrawResult } from "./liquidity.ts";
import type { InventoryRange, ReserveRange, TakeResult } from "./range.ts";
import {
    absoluteTickToPrice,
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
    reserve: E8s;
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
    depositedReserve: E8s;
};

/**
 * Total liquidity of the AMM
 */
export type LiquidityDigest = {
    curTick: {
        idx: number;
        reserve: E8s;
        inventory: E8s;
    };
    recoveryBin: {
        collateral: E8s;
        worstTick?: TakeResult;
    };
    reserve?: ReserveRange;
    inventory: InventoryRange[];
};

export class AMM {
    private _depositedReserve = E8s.zero();
    private _liquidity: Liquidity;
    private _currentTick: CurrentTick;

    constructor(
        private side: Side,
        private isDrifting: boolean,
        private noLogs: boolean,
        curTickIdx: number,
        args?: {
            reserveQty: E8s;
            inventoryQty: E8s;
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
                args.reserveQty.clone(),
                args.inventoryQty.clone(),
                curTickIdx,
                args.tickSpan
            );
            this._depositedReserve = args.reserveQty.add(respectiveReserve);
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

        a._depositedReserve = this._depositedReserve.clone();

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
            this._depositedReserve.addAssign(args.reserve);
        }
    }

    public withdraw(args: WithdrawArgs): WithdrawResult {
        const cut = args.depositedReserve.div(this._depositedReserve);
        const reserve = E8s.zero();
        const inventory = E8s.zero();

        if (this._liquidity.reserve.isInitted()) {
            reserve.addAssign(this._liquidity.reserve.withdrawCut(cut));
            this._liquidity.inventory.notifyReserveChanged();
        }

        if (this._currentTick) {
            const { reserve: r, inventory: i } =
                this._currentTick.withdrawCut(cut);
            reserve.addAssign(r);
            inventory.addAssign(i);
        }

        if (!this._liquidity.inventory.isEmpty()) {
            let respectiveReserve =
                this._liquidity.inventory.respectiveReserve.mul(cut);

            // swapping backwards, which makes early leavers get a worse return, but resolves the IL faster and has better performance

            while (!respectiveReserve.isZero()) {
                const worstTick = this._liquidity.inventory.takeWorst();
                if (!worstTick) panic("Worst tick should exist");

                const worstTickRespectiveReserve = worstTick.inventory.mul(
                    absoluteTickToPrice(worstTick.idx, this.side, "inventory")
                );

                if (worstTickRespectiveReserve.ge(respectiveReserve)) {
                    const takeInventory = respectiveReserve.mul(
                        absoluteTickToPrice(worstTick.idx, this.side, "reserve")
                    );
                    worstTick.inventory.subAssign(takeInventory);

                    if (!worstTick.inventory.isZero()) {
                        this._liquidity.inventory.putWorstNewRange(worstTick);
                    }

                    inventory.addAssign(takeInventory);

                    break;
                }

                inventory.addAssign(worstTick.inventory);
                respectiveReserve.subAssign(worstTickRespectiveReserve);

                if (
                    !respectiveReserve.isZero() &&
                    this._liquidity.inventory.isEmpty()
                ) {
                    panic(
                        `Still missing ${respectiveReserve} respective reserve, but the inventory is empty`
                    );
                }
            }
        }

        this._depositedReserve.subAssign(args.depositedReserve);

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

    public get il(): E8s {
        if (this._liquidity.inventory.qty.isZero()) {
            return E8s.zero();
        }

        const leftoverReserve = this._liquidity.reserve.qty;

        const expectedReserve = this._liquidity.inventory.qty.mul(
            absoluteTickToPrice(this.currentTick.index, this.side, "inventory")
        );

        const respectiveReserve = this._liquidity.inventory.respectiveReserve;

        return E8s.one().sub(
            expectedReserve
                .add(leftoverReserve)
                .div(respectiveReserve.add(leftoverReserve))
        );
    }

    public get depositedReserve(): E8s {
        return this._depositedReserve.clone();
    }

    public get actualReserve(): E8s {
        return this._liquidity.reserve.qty.add(
            this.currentTick.getLiquidity().reserve
        );
    }

    public get actualInventory(): E8s {
        return this._liquidity.inventory.qty
            .add(this.currentTick.getLiquidity().inventory)
            .add(this.currentTick.getRecoveryBin().collateral);
    }

    public get respectiveReserve(): E8s {
        return this._liquidity.inventory.respectiveReserve.add(
            this.currentTick
                .getLiquidity()
                .inventory.mul(
                    absoluteTickToPrice(
                        this.currentTick.index,
                        this.side,
                        "inventory"
                    )
                )
        );
    }

    public isBase() {
        return this.side === "base";
    }
}
