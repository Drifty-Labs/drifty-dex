import { Beacon } from "./beacon.ts";
import { ECs } from "./ecs.ts";
import { Liquidity } from "./liquidity.ts";
import { Pool } from "./pool.ts";
import { panic } from "./utils.ts";

export type RecoverArgs = {
    reserveIn: ECs;
    curTickIdx: number;
};

export type RecoverResult = {
    inventoryOut: ECs;
    reminderReserveIn: ECs;
};

/**
 * Fee-funded IL repair engine that focuses on a single worst tick at a time.
 */
export class RecoveryBin {
    private _collateral = ECs.zero();

    constructor(private liquidity: Liquidity, private $: Beacon) {}

    public clone(pool: Pool, newLiquidity: Liquidity, noLogs: boolean) {
        const r = new RecoveryBin(newLiquidity, this.$.clone({ noLogs, pool }));

        r._collateral = this._collateral.clone();

        return r;
    }

    public withdrawCut(cut: ECs): ECs {
        const collateralToWithdraw = this._collateral.mul(cut);
        this._collateral.subAssign(collateralToWithdraw);

        return collateralToWithdraw;
    }

    public recover(args: RecoverArgs): RecoverResult {
        const inventoryOut = ECs.zero();
        const reminderReserveIn = args.reserveIn.clone();

        if (this._collateral.isZero()) {
            return {
                inventoryOut,
                reminderReserveIn,
            };
        }

        this.liquidity.borrowInventoryForRecovery((wt) => {
            if (wt.tickIdx === args.curTickIdx) {
                return undefined;
            }

            if (reminderReserveIn.lt(wt.reserveQty)) {
                const haveInventory = reminderReserveIn.mul(
                    this.$.price(wt.tickIdx)
                );
                const wantInventory = reminderReserveIn.mul(
                    this.$.price(args.curTickIdx)
                );

                if (wantInventory.lt(haveInventory)) {
                    panic(
                        `[RecoveryBin ${this.$}] Should always require more inventory to recover the tick`
                    );
                }

                const missingInventoryToBreakEven =
                    wantInventory.sub(haveInventory);

                if (this._collateral.ge(missingInventoryToBreakEven)) {
                    this._collateral.subAssign(missingInventoryToBreakEven);

                    inventoryOut.addAssign(wantInventory);
                    const leftoverReserveQty =
                        wt.reserveQty.sub(reminderReserveIn);
                    reminderReserveIn.subAssign(reminderReserveIn);

                    return {
                        curTickIdx: args.curTickIdx,
                        leftoverReserveQty: leftoverReserveQty,
                    };
                }

                const recoveredShare = this._collateral.div(
                    missingInventoryToBreakEven
                );
                const recoveredReserve = reminderReserveIn.mul(recoveredShare);
                const recoveredInventory = wantInventory.mul(recoveredShare);

                inventoryOut.addAssign(recoveredInventory);
                reminderReserveIn.subAssign(recoveredReserve);
                this._collateral = ECs.zero();

                return {
                    curTickIdx: args.curTickIdx,
                    leftoverReserveQty: wt.reserveQty.sub(recoveredReserve),
                };
            }

            const wantInventory = wt.reserveQty.mul(
                this.$.price(args.curTickIdx)
            );

            if (wantInventory.lt(wt.respectiveInventoryQty)) {
                panic(
                    `[RecoveryBin ${this.$}] Should always require more inventory to recover the tick`
                );
            }

            const missingInventoryToBreakEven = wantInventory.sub(
                wt.respectiveInventoryQty
            );

            // if we have enough
            if (this._collateral.ge(missingInventoryToBreakEven)) {
                this._collateral.subAssign(missingInventoryToBreakEven);

                inventoryOut.addAssign(wantInventory.clone());
                reminderReserveIn.subAssign(wt.reserveQty);

                return {
                    curTickIdx: args.curTickIdx,
                    leftoverReserveQty: ECs.zero(),
                };
            }

            const recoveredShare = this._collateral.div(
                missingInventoryToBreakEven
            );
            const recoveredReserve = wt.reserveQty.mul(recoveredShare);
            const recoveredInventory =
                wt.respectiveInventoryQty.mul(recoveredShare);
            const recoveredWantInventory =
                this._collateral.add(recoveredInventory);

            inventoryOut.addAssign(recoveredWantInventory);
            reminderReserveIn.subAssign(recoveredReserve);
            this._collateral = ECs.zero();

            return {
                curTickIdx: args.curTickIdx,
                leftoverReserveQty: wt.reserveQty.sub(recoveredReserve),
            };
        });

        // Uncomment to sell unused fees, instead of holding them for later

        if (this._collateral.isZero()) {
            return {
                inventoryOut,
                reminderReserveIn,
            };
        }

        const reserveForCollateral = this._collateral.mul(
            this.$.price(args.curTickIdx, "inventory")
        );

        if (reminderReserveIn.ge(reserveForCollateral)) {
            inventoryOut.addAssign(this._collateral);
            reminderReserveIn.subAssign(reserveForCollateral);
            this._collateral = ECs.zero();

            this.liquidity.deposit(reserveForCollateral, args.curTickIdx);

            return {
                inventoryOut,
                reminderReserveIn,
            };
        }

        const recoveredShare = reminderReserveIn.div(reserveForCollateral);
        const recoveredInventory = this._collateral.mul(recoveredShare);
        const recoveredReserve = reserveForCollateral.mul(recoveredShare);

        this._collateral.subAssign(recoveredInventory);
        inventoryOut.addAssign(recoveredInventory);
        reminderReserveIn.subAssign(recoveredReserve);

        this.liquidity.deposit(recoveredReserve, args.curTickIdx);

        return {
            inventoryOut,
            reminderReserveIn,
        };
    }

    public addCollateral(fees: ECs) {
        this._collateral.addAssign(fees);
    }

    public getCollateral(): ECs {
        return this._collateral.clone();
    }
}
