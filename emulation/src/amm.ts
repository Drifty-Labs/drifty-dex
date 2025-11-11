// TODO: instead of inverting the price for AMMs, let's just invert ticks
// TODO: price inside an AMM is defined as "how much reserve for 1 unit of inventory"
// TODO: meaning that we draw reserve from right to the left

import { CurrentTick } from "./cur-tick.ts";
import { Inventory, Reserve } from "./liquidity.ts";
import { TickIndex, TickIndexFactory } from "./ticks.ts";
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
    private fees: number = 0;
    private reserve: Reserve = new Reserve();
    private inventory: Inventory = new Inventory();
    private currentTick: CurrentTick | undefined = undefined;
    private initted: boolean = false;

    public init(reserve: number, curTickIdx: number) {
        this.assertNotInitted();

        this.reserve.init(
            reserve,
            this.tickIndexFactory.min(),
            this.tickIndexFactory.make(curTickIdx)
        );
    }

    public deposit(args: DepositArgs): void {
        if (this.currentTick === undefined) {
            this.reserve.put(args.reserve);
            return;
        }

        const width = this.reserve.width + 1;
        const addToReserve = (args.reserve * this.reserve.width) / width;
        const addToCurTick = args.reserve - addToReserve;

        this.reserve.put(addToReserve);
        this.currentTick.deposit(addToCurTick);
    }

    // TODO: implement withdraw from the end
    // TODO: remember that current tick can be undefined and what to do with it

    public withdraw(args: WithdrawArgs): WithdrawResult {
        const cut = args.depositedReserve / this.depositedReserve;

        const reserve = this.reserveQty * cut;
        this.reserveQty -= reserve;

        let curTickReserve = 0;
        let curTickInventory = 0;

        if (this.curTick) {
            curTickReserve = this.curTick.reserve * cut;
            this.curTick.reserve -= curTickReserve;

            curTickInventory = this.curTick.inventory * cut;
            this.curTick.inventory -= curTickInventory;
        }

        // TODO: force them to get from the end of the IL
        // this will do 2 things: a) make early leavers consume IL, b) ensure withdraw has the same performance as simple swaps
        // can be enabled if there are, for example, more than 200 inventory ranges.
        // how to do it though?

        const inventory = this.inventory.reduce((acc, cur) => {
            const inv = cur.qty * cut;
            cur.qty -= inv;

            return acc + inv;
        }, 0);

        this.needsNewInventoryRange = true;
        this.depositedReserve -= args.depositedReserve;
        this.inventoryTotal -= inventory + curTickInventory;

        return {
            reserve: reserve + curTickReserve,
            inventory: inventory + curTickInventory,
        };
    }

    public addFees(fees: number) {
        this.fees += fees;
    }

    public isInitted() {
        return this.initted;
    }

    private assertInitted() {
        if (!this.isInitted()) panic("The AMM is not initialized!");
    }

    private assertNotInitted() {
        if (this.isInitted()) panic("The AMM is already initialized");
    }

    constructor(private tickIndexFactory: TickIndexFactory) {}
}
