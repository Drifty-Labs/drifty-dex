import { InventoryRange, ReserveRange, type TakeResult } from "./range.ts";
import { TickIndex } from "./ticks.ts";
import { almostEq, panic, tickToPrice } from "./utils.ts";

/**
 * The result of a withdrawal operation.
 */
export type WithdrawResult = {
    /** The amount of reserve withdrawn. */
    reserve: number;
    /** The amount of inventory withdrawn. */
    inventory: number;
};

/**
 * Represents a tick with a certain amount of reserve liquidity.
 */
export type ReserveTick = {
    /** The amount of reserve liquidity. */
    reserve: number;
    /** The index of the tick. */
    idx: TickIndex;
};

export class Reserve {
    private range: ReserveRange | undefined = undefined;

    public clone() {
        const r = new Reserve();
        r.range = this.range?.clone();

        return r;
    }

    public init(qty: number, left: TickIndex, right: TickIndex) {
        this.assertNotInitted();

        this.range = new ReserveRange(qty, left, right);
    }

    public withdrawCut(cut: number): number {
        this.assertInitted();

        return this.range!.withdrawCut(cut);
    }

    public putUniform(qty: number) {
        this.assertInitted();

        this.range!.put(qty);
    }

    public putRight(qty: number) {
        this.assertInitted();

        this.range!.putBest(qty);
    }

    public takeRight(): ReserveTick | undefined {
        if (!this.isInitted()) return undefined;

        const result = this.range!.takeBest();

        if (this.range!.isEmpty()) {
            this.range = undefined;
        }

        return {
            reserve: result.qty,
            idx: result.tickIdx,
        };
    }

    public peekRight(): ReserveTick | undefined {
        if (!this.isInitted()) return undefined;

        const result = this.range!.peekBest();

        return {
            reserve: result.qty,
            idx: result.tickIdx,
        };
    }

    public driftLeft(newLeft: TickIndex) {
        this.assertInitted();
        this.range!.setLeft(newLeft);
    }

    public peekLeft(): ReserveTick | undefined {
        if (!this.isInitted()) return undefined;

        const result = this.range!.peekWorst();

        return {
            reserve: result.qty,
            idx: result.tickIdx,
        };
    }

    public get qtyPerTick(): number {
        this.assertInitted();

        return this.qty / this.width;
    }

    public get width(): number {
        this.assertInitted();

        return this.range!.width;
    }

    public get qty(): number {
        this.assertInitted();

        return this.range!.getQty();
    }

    public isInitted() {
        return this.range !== undefined;
    }

    public unpack(curTick: TickIndex, tickSpan: number): TakeResult[] {
        return this.range?.unpack(curTick, tickSpan) ?? [];
    }

    private assertInitted() {
        if (!this.isInitted()) panic("The reserve range is not initted");
    }

    private assertNotInitted() {
        if (this.isInitted()) panic("The reserve is already initted");
    }
}

export type InventoryTick = {
    /** The amount of inventory liquidity. */
    inventory: number;
    /** The index of the tick. */
    idx: TickIndex;
};

export class Inventory {
    private _respectiveReserve: number = 0;
    private allocatedQty: number = 0;
    private shouldSpawnNew: boolean = true;
    private ranges: InventoryRange[] = [];

    public clone() {
        const i = new Inventory();

        i._respectiveReserve = this._respectiveReserve;
        i.allocatedQty = this.allocatedQty;
        i.shouldSpawnNew = this.shouldSpawnNew;
        i.ranges = this.ranges.map((it) => it.clone());

        return i;
    }

    public init(qty: number, left: TickIndex, right: TickIndex) {
        if (this.ranges.length > 0) panic("Can only init inventory once");

        const range = new InventoryRange(qty, left, right);
        this.ranges.push(range);
        this.allocatedQty = qty;
        this._respectiveReserve = range.calcRespectiveReserve();

        return this._respectiveReserve;
    }

    public takeRight(): InventoryTick | undefined {
        if (this.isEmpty()) return undefined;

        const range = this.ranges[this.ranges.length - 1];
        const result = range.takeWorst();

        if (range.isEmpty()) {
            this.ranges.pop();
        }

        this.allocatedQty -= result.qty;
        this._respectiveReserve -=
            result.qty * tickToPrice(result.tickIdx, "inventory");

        return {
            inventory: result.qty,
            idx: result.tickIdx,
        };
    }

    public peekRight(): InventoryTick | undefined {
        if (this.isEmpty()) return undefined;

        const range = this.ranges[this.ranges.length - 1];
        const result = range.peekWorst();

        return {
            inventory: result.qty,
            idx: result.tickIdx,
        };
    }

    public putRightNewRange(tick: InventoryTick) {
        // Invariant: New worst must be strictly greater (further right) than current worst
        if (!this.isEmpty()) {
            const currentWorst = this.peekRight();
            if (currentWorst && !tick.idx.gt(currentWorst.idx)) {
                panic(
                    `Inventory invariant violated: New worst tick ${tick.idx.index()} must be greater than current worst ${currentWorst.idx.index()}`
                );
            }
        }

        this._respectiveReserve +=
            tick.inventory * tickToPrice(tick.idx, "inventory");
        this.allocatedQty += tick.inventory;

        const range = new InventoryRange(
            tick.inventory,
            tick.idx,
            tick.idx.clone()
        );
        this.ranges.push(range);

        return;
    }

    public takeLeft(curTickIdx: TickIndex): InventoryTick | undefined {
        if (this.isEmpty()) return undefined;

        const range = this.ranges[0];

        // IL ranges can have voids in between
        // check if the best is the same as the provided one, otherwise return undefined
        const bestTickIdx = range.bestTickIdx();

        if (!bestTickIdx.eq(curTickIdx)) {
            return undefined;
        }

        const result = range.takeBest();

        if (range.isEmpty()) {
            this.ranges.shift();
        }

        this.allocatedQty -= result.qty;
        this._respectiveReserve -=
            result.qty * tickToPrice(result.tickIdx, "inventory");

        return {
            inventory: result.qty,
            idx: result.tickIdx,
        };
    }

    public peekLeft(): InventoryTick | undefined {
        if (this.isEmpty()) return undefined;

        const range = this.ranges[0];
        const result = range.peekBest();

        return {
            inventory: result.qty,
            idx: result.tickIdx,
        };
    }

    public putLeft(tick: InventoryTick) {
        if (!this.isEmpty()) {
            const bestRange = this.ranges[0];
            const currentBestIdx = bestRange.bestTickIdx();

            if (!tick.idx.lt(currentBestIdx)) {
                panic(
                    `Inventory invariant violated: New best tick ${tick.idx.index()} must be less than current best ${currentBestIdx.index()}`
                );
            }
        }

        this._respectiveReserve +=
            tick.inventory * tickToPrice(tick.idx, "inventory");
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

    public notifyReserveChanged() {
        this.shouldSpawnNew = true;
    }

    public get respectiveReserve() {
        return this._respectiveReserve;
    }

    public get qty() {
        return this.allocatedQty;
    }

    public isEmpty() {
        return almostEq(this.ranges.length, 0);
    }

    public unpack(curTick: TickIndex, tickSpan: number): TakeResult[] {
        const result: TakeResult[] = [];

        for (const range of this.ranges) {
            result.push(...range.unpack(curTick, tickSpan));
        }

        return result;
    }

    private assertNotEmpty() {
        if (this.isEmpty()) panic("The inventory is empty");
    }
}

export class Liquidity {
    private reserve: Reserve = new Reserve();
    private inventory: Inventory = new Inventory();

    public clone() {
        const l = new Liquidity();

        l.reserve = this.reserve.clone();
        l.inventory = this.inventory.clone();

        return l;
    }

    public init(
        reserveQty: number,
        inventoryQty: number,
        curTickIdx: TickIndex,
        tickSpan?: number
    ) {
        const reserveRight = curTickIdx.clone().dec();
        const reserveLeft = tickSpan
            ? reserveRight.clone().sub(tickSpan)
            : curTickIdx.min();

        const inventoryLeft = curTickIdx.clone().inc();
        const inventoryRight = tickSpan
            ? inventoryLeft.clone().add(tickSpan)
            : curTickIdx.max();

        console.log(
            reserveLeft.distance(reserveRight),
            inventoryLeft.distance(inventoryRight)
        );

        this.reserve.init(reserveQty, reserveLeft, reserveRight);
        return this.inventory.init(inventoryQty, inventoryLeft, inventoryRight);
    }

    public driftReserve(targetLeft: TickIndex) {
        this.reserve.driftLeft(targetLeft);
    }

    public obtainInventoryTick(
        reserveTick: ReserveTick | undefined,
        curTickIdx: TickIndex
    ): InventoryTick | undefined {
        if (reserveTick) {
            if (!this.reserve.isInitted()) {
                this.reserve.init(
                    reserveTick.reserve,
                    reserveTick.idx.clone(),
                    reserveTick.idx.clone()
                );
                this.inventory.notifyReserveChanged();
            } else {
                this.reserve.putRight(reserveTick.reserve);
                this.inventory.notifyReserveChanged();
            }
        } else {
            if (this.reserve.isInitted()) {
                this.reserve.putRight(0);
                this.inventory.notifyReserveChanged();
            }
        }

        return this.inventory.takeLeft(curTickIdx);
    }

    public obtainReserveTick(
        inventoryTick: InventoryTick | undefined
    ): ReserveTick | undefined {
        if (inventoryTick) this.inventory.putLeft(inventoryTick);

        if (!this.reserve.isInitted()) return undefined;
        const tick = this.reserve.takeRight();

        return tick;
    }

    public getReserve() {
        return this.reserve;
    }

    public getInventory() {
        return this.inventory;
    }
}
