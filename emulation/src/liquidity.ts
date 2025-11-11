import { InventoryRange, ReserveRange } from "./range.ts";
import { TickIndex } from "./ticks.ts";
import { panic } from "./utils.ts";

export type ReserveTick = {
    reserve: number;
    respectiveInventory: number;
    idx: TickIndex;
};

export class Reserve {
    private range: ReserveRange | undefined = undefined;

    public get width(): number {
        this.assertInitted();

        return this.range!.width;
    }

    public takeBest(): ReserveTick {
        this.assertInitted();

        const result = this.range!.takeBest();

        return {
            reserve: result.qty,
            respectiveInventory: result.qty * result.tickIdx.getPrice(),
            idx: result.tickIdx,
        };
    }

    public takeWorst(): ReserveTick {
        this.assertInitted();

        const result = this.range!.takeWorst();

        return {
            reserve: result.qty,
            respectiveInventory: result.qty * result.tickIdx.getPrice(),
            idx: result.tickIdx,
        };
    }

    public stretchToCurTick(curTickIdx: TickIndex) {
        this.assertInitted();
        this.range!.stretchToRight(curTickIdx);
    }

    public put(qty: number) {
        this.assertInitted();

        this.range!.put(qty);
    }

    public init(qty: number, left: TickIndex, right: TickIndex) {
        this.assertNotInitted();

        this.range = new ReserveRange(qty, left, right);
    }

    private assertInitted() {
        if (!this.isInitted()) panic("The reserve range is not initted");
    }

    private assertNotInitted() {
        if (this.isInitted()) panic("The reserve is already initted");
    }

    public isInitted() {
        return this.range !== undefined;
    }
}

export type InventoryTick = {
    inventory: number;
    respectiveReserve: number;
    idx: TickIndex;
};

export class Inventory {
    private usedReserve: number = 0;
    private allocatedQty: number = 0;
    private shouldSpawnNew: boolean = true;
    private ranges: InventoryRange[] = [];

    public takeBest(): InventoryTick {
        this.assertNotEmpty();

        const range = this.ranges[0];
        const result = range.takeBest();

        if (range.isEmpty()) {
            this.ranges.shift();
        }

        this.allocatedQty -= result.qty;

        const unusedReserve = result.qty / result.tickIdx.getPrice();
        this.usedReserve -= unusedReserve;

        return {
            inventory: result.qty,
            respectiveReserve: unusedReserve,
            idx: result.tickIdx,
        };
    }

    public takeWorst(): InventoryTick {
        this.assertNotEmpty();

        const range = this.ranges[this.ranges.length - 1];
        const result = range.takeWorst();

        if (range.isEmpty()) {
            this.ranges.pop();
        }

        this.allocatedQty -= result.qty;

        const unusedReserve = result.qty / result.tickIdx.getPrice();
        this.usedReserve -= unusedReserve;

        return {
            inventory: result.qty,
            respectiveReserve: unusedReserve,
            idx: result.tickIdx,
        };
    }

    public putBest(tick: InventoryTick) {
        this.usedReserve += tick.respectiveReserve;
        this.allocatedQty += tick.inventory;

        if (this.shouldSpawnNew) {
            const range = new InventoryRange(
                tick.inventory,
                tick.idx,
                tick.idx.clone()
            );

            this.shouldSpawnNew = false;
            this.ranges.unshift(range);

            return;
        }

        this.assertNotEmpty();

        const range = this.ranges[0];
        range.putBest(tick.inventory, tick.idx);
    }

    public isEmpty() {
        return this.ranges.length === 0;
    }

    private assertNotEmpty() {
        if (this.isEmpty()) panic("The inventory is empty");
    }

    public notifyReserveChanged() {
        this.shouldSpawnNew = true;
    }
}
