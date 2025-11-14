import { InventoryRange, ReserveRange } from "./range.ts";
import { TickIndex } from "./ticks.ts";
import { panic } from "./utils.ts";

export type ReserveTick = {
    reserve: number;
    idx: TickIndex;
};

export class Reserve {
    private range: ReserveRange | undefined = undefined;

    public withdrawCut(cut: number): number {
        this.assertInitted();

        return this.range!.withdrawCut(cut);
    }

    public get width(): number {
        this.assertInitted();

        return this.range!.width;
    }

    public takeBest(): ReserveTick | undefined {
        if (!this.isInitted()) return undefined;

        const result = this.range!.takeBest();

        return {
            reserve: result.qty,
            idx: result.tickIdx,
        };
    }

    public takeWorst(): ReserveTick | undefined {
        if (!this.isInitted()) return undefined;

        const result = this.range!.takeWorst();

        return {
            reserve: result.qty,
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
    idx: TickIndex;
};

export class Inventory {
    private respectiveReserve: number = 0;
    private allocatedQty: number = 0;
    private shouldSpawnNew: boolean = true;
    private ranges: InventoryRange[] = [];

    public getRespectiveReserve() {
        return this.respectiveReserve;
    }

    public takeBest(curTickIdx: TickIndex): InventoryTick | undefined {
        if (this.isEmpty()) return undefined;

        const range = this.ranges[0];

        // IL ranges can have voids in between
        // check if the best is the same as the provided one, otherwise return undefined
        const bestTickIdx = range.betTickIdx();
        if (!bestTickIdx.eq(curTickIdx)) {
            return undefined;
        }

        const result = range.takeBest();

        if (range.isEmpty()) {
            this.ranges.shift();
        }

        this.allocatedQty -= result.qty;

        const unusedReserve = result.qty / result.tickIdx.getPrice();
        this.respectiveReserve -= unusedReserve;

        return {
            inventory: result.qty,
            idx: result.tickIdx,
        };
    }

    public takeWorst(): InventoryTick | undefined {
        if (this.isEmpty()) return undefined;

        const range = this.ranges[this.ranges.length - 1];
        const result = range.takeWorst();

        if (range.isEmpty()) {
            this.ranges.pop();
        }

        this.allocatedQty -= result.qty;

        const unusedReserve = result.qty / result.tickIdx.getPrice();
        this.respectiveReserve -= unusedReserve;

        return {
            inventory: result.qty,
            idx: result.tickIdx,
        };
    }

    public putWorstNewRange(tick: InventoryTick) {
        this.respectiveReserve += tick.inventory / tick.idx.getPrice();
        this.allocatedQty += tick.inventory;

        const range = new InventoryRange(
            tick.inventory,
            tick.idx,
            tick.idx.clone()
        );
        this.ranges.push(range);

        return;
    }

    public putBest(tick: InventoryTick) {
        this.respectiveReserve += tick.inventory / tick.idx.getPrice();
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
