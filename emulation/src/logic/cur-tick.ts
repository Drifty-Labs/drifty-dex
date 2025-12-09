import { Beacon } from "./beacon.ts";
import { ECs } from "./ecs.ts";
import { Liquidity } from "./liquidity.ts";
import { type TakeResult } from "./range.ts";
import { RecoveryBin } from "./recovery-bin.ts";
import { type AMMSwapDirection, panic, type TwoAmmSided } from "./utils.ts";

export type CurrentTickSwapArgs = {
    direction: AMMSwapDirection;
    qtyIn: ECs;
};

export type CurrentTickSwapResult = {
    qtyOut: ECs;
    reminderIn: ECs;
};

export class CurrentTick {
    private _targetReserve = ECs.zero();
    private _currentReserve = ECs.zero();

    private _recoveryBin: RecoveryBin;

    constructor(
        private _index: number,
        private liquidity: Liquidity,
        private $: Beacon
    ) {
        this._recoveryBin = new RecoveryBin(this.liquidity, this.$.clone());
    }

    public clone(newLiquidity: Liquidity, noLogs: boolean) {
        const c = new CurrentTick(
            this._index,
            newLiquidity,
            this.$.clone({ noLogs })
        );

        c._targetReserve = this._targetReserve.clone();
        c._currentReserve = this._currentReserve.clone();
        c._recoveryBin = this._recoveryBin.clone(newLiquidity, noLogs);

        return c;
    }

    public addInventoryFees(fees: ECs) {
        this._recoveryBin.addCollateral(fees);
    }

    public swap(args: CurrentTickSwapArgs): CurrentTickSwapResult {
        if (args.direction === "reserve -> inventory") {
            const { reminderReserveIn, inventoryOut } =
                this._recoveryBin.recover({
                    curTickIdx: this._index,
                    reserveIn: args.qtyIn.clone(),
                });

            const respectiveReserve = this._targetReserve.sub(
                this._currentReserve
            );

            if (reminderReserveIn.isZero() || respectiveReserve.isZero()) {
                return {
                    qtyOut: inventoryOut,
                    reminderIn: reminderReserveIn,
                };
            }

            if (respectiveReserve.ge(reminderReserveIn)) {
                this._currentReserve.addAssign(reminderReserveIn);
                inventoryOut.addAssign(
                    reminderReserveIn.mul(this.$.price(this._index))
                );

                return {
                    qtyOut: inventoryOut,
                    reminderIn: ECs.zero(),
                };
            }

            this._currentReserve = this._targetReserve.clone();
            inventoryOut.addAssign(
                respectiveReserve.mul(this.$.price(this._index))
            );
            reminderReserveIn.subAssign(respectiveReserve);

            return {
                qtyOut: inventoryOut,
                reminderIn: reminderReserveIn,
            };
        }

        if (this._currentReserve.isZero())
            return {
                qtyOut: ECs.zero(),
                reminderIn: args.qtyIn,
            };

        const needsReserve = args.qtyIn.mul(
            this.$.price(this._index, "inventory")
        );

        if (needsReserve.le(this._currentReserve)) {
            this._currentReserve.subAssign(needsReserve);

            return {
                qtyOut: needsReserve,
                reminderIn: ECs.zero(),
            };
        }

        const getsReserve = this._currentReserve.clone();
        const reminderReserve = needsReserve.sub(getsReserve);
        const reminderInventory = reminderReserve.mul(
            this.$.price(this._index)
        );

        this._currentReserve = ECs.zero();

        return {
            qtyOut: getsReserve,
            reminderIn: reminderInventory,
        };
    }

    public prepareSwap(direction: AMMSwapDirection) {
        const fromCurTick: TakeResult = {
            tickIdx: this._index,
            reserveQty: this._targetReserve.clone(),
            respectiveInventoryQty: this._targetReserve.mul(
                this.$.price(this._index)
            ),
        };

        if (direction === "reserve -> inventory") {
            if (!this._currentReserve.eq(this._targetReserve))
                panic(
                    `[Curtick ${this.$}] Only a fully consumed curtick can be switched`
                );

            if (this.$.isBase) this._index -= 1;
            else this._index += 1;
        } else {
            if (!this._currentReserve.isZero())
                panic(
                    `[Curtick ${this.$}] Only a fully consumed curtick can be switched`
                );

            if (this.$.isBase) this._index += 1;
            else this._index -= 1;
        }

        const newTick = this.liquidity.takeNextTick(
            direction,
            fromCurTick,
            this._index
        );

        if (direction === "reserve -> inventory") {
            this.putInventoryTick(newTick);
        } else {
            this.putReserveTick(newTick);
        }
    }

    public withdrawCut(cut: ECs): TwoAmmSided<ECs> {
        const reserve = this._currentReserve.mul(cut);
        const inventory = this.getCurrentInventory().mul(cut);

        this._currentReserve.subAssign(reserve);
        this._targetReserve.mulAssign(ECs.one().sub(cut));

        const recoveryBinInventory = this._recoveryBin.withdrawCut(cut);

        return { reserve, inventory: inventory.add(recoveryBinInventory) };
    }

    public getIndex(): number {
        return this._index;
    }

    private putInventoryTick(tick: TakeResult) {
        if (tick.tickIdx !== this._index)
            panic(
                `[Curtick ${this.$}] Ticks don't match: old=${this._index}, new=${tick.tickIdx}`
            );

        this._targetReserve = tick.reserveQty.clone();
        this._currentReserve = ECs.zero();
    }

    private putReserveTick(tick: TakeResult) {
        if (tick.tickIdx !== this._index) {
            panic(
                `[Curtick ${this.$}] Ticks don't match: old=${this._index} new=${tick.tickIdx}`
            );
        }

        this._targetReserve = tick.reserveQty.clone();
        this._currentReserve = tick.reserveQty.clone();
    }

    public getRecoveryBin() {
        return this._recoveryBin;
    }

    public getCurrentReserve() {
        return this._currentReserve.clone();
    }

    public getCurrentInventory() {
        return this._targetReserve
            .sub(this._currentReserve)
            .mul(this.$.price(this._index));
    }

    public getTargetReserve() {
        return this._targetReserve.clone();
    }
}
