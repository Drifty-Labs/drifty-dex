import {
    CurrentTick,
    CurrentTickSwapArgs,
    CurrentTickSwapResult,
} from "./cur-tick.ts";
import { Inventory, Reserve } from "./liquidity.ts";
import { TickIndex } from "./ticks.ts";
import { panic } from "./utils.ts";

export type DepositArgs = {
    reserve: number;
};

export type WithdrawArgs = {
    depositedReserve: number;
};

export type WithdrawResult = {
    reserve: number;
    inventory: number;
};

export class AMM {
    private depositedReserve: number = 0;
    private reserve: Reserve = new Reserve();
    private inventory: Inventory = new Inventory();
    private currentTick: CurrentTick;

    public swapCurTick(args: CurrentTickSwapArgs): CurrentTickSwapResult {
        return this.currentTick.swap(args);
    }

    public deposit(args: DepositArgs): void {
        if (!this.reserve.isInitted()) {
            this.currentTick.deposit(args.reserve);
        } else {
            const fullWidth = this.reserve.width + 1;
            const addToReserve =
                (args.reserve * this.reserve.width) / fullWidth;
            const addToCurTick = args.reserve - addToReserve;

            this.reserve.put(addToReserve);
            this.currentTick.deposit(addToCurTick);
        }

        this.depositedReserve += args.reserve;
    }

    public withdraw(args: WithdrawArgs): WithdrawResult {
        const cut = args.depositedReserve / this.depositedReserve;
        let reserve = 0;
        let inventory = 0;

        if (this.reserve.isInitted()) {
            reserve += this.reserve.withdrawCut(cut);
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

        return { reserve, inventory };
    }

    public addInventoryFees(fees: number) {
        this.currentTick.addInventoryFees(fees);
    }

    constructor(curTickIdx: TickIndex) {
        this.currentTick = new CurrentTick(
            curTickIdx,
            this.reserve,
            this.inventory
        );
    }
}
