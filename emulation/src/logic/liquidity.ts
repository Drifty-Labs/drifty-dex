import { InventoryRange, ReserveRange } from "./range.ts";
import {
    absoluteTickToPrice,
    MAX_TICK,
    MIN_TICK,
    panic,
    type Side,
} from "./utils.ts";

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
    idx: number;
};

export class Reserve {
    private range: ReserveRange | undefined = undefined;

    constructor(
        private _side: Side,
        private noLogs: boolean,
        private isDrifting: boolean
    ) {}

    public clone(noLogs: boolean) {
        const r = new Reserve(this.side, noLogs, this.isDrifting);
        r.range = this.range?.clone(noLogs);

        return r;
    }

    public init(qty: number, left: number, right: number) {
        this.assertNotInitted();

        this.range = new ReserveRange(
            qty,
            left,
            right,
            this.side,
            this.noLogs,
            this.isDrifting
        );
    }

    public withdrawCut(cut: number): number {
        this.assertInitted();

        const qtyOut = this.range!.withdrawCut(cut);

        if (this.range!.isEmpty()) {
            this.range = undefined;
        }

        return qtyOut;
    }

    public putUniform(qty: number) {
        this.assertInitted();

        this.range!.put(qty);
    }

    public putBest(qty: number) {
        this.assertInitted();

        this.range!.putBest(qty);
    }

    public takeBest(): ReserveTick | undefined {
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

    public peekBest(): ReserveTick | undefined {
        if (!this.isInitted()) return undefined;

        const result = this.range!.peekBest();

        return {
            reserve: result.qty,
            idx: result.tickIdx,
        };
    }

    public driftWorst(newWorst: number) {
        this.assertInitted();
        this.range!.setWorst(newWorst);
    }

    public peekWorst(): ReserveTick | undefined {
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
        return this.range?.qty ?? 0;
    }

    public get side() {
        return this._side;
    }

    public isInitted() {
        return this.range !== undefined;
    }

    public getRange(): ReserveRange | undefined {
        return this.range?.clone(this.noLogs);
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
    idx: number;
};

export class Inventory {
    private _respectiveReserve: number = 0;
    private allocatedQty: number = 0;
    private shouldSpawnNew: boolean = true;
    private ranges: InventoryRange[] = [];

    constructor(
        private _side: Side,
        private noLogs: boolean,
        private isDrifting: boolean
    ) {}

    public clone(noLogs: boolean) {
        const i = new Inventory(this._side, noLogs, this.isDrifting);

        i._respectiveReserve = this._respectiveReserve;
        i.allocatedQty = this.allocatedQty;
        i.shouldSpawnNew = this.shouldSpawnNew;
        i.ranges = this.ranges.map((it) => it.clone(noLogs));

        return i;
    }

    public init(qty: number, left: number, right: number) {
        if (this.ranges.length > 0) panic("Can only init inventory once");

        const range = new InventoryRange(
            qty,
            left,
            right,
            this.side,
            this.noLogs,
            this.isDrifting
        );
        this.ranges.push(range);
        this.allocatedQty = qty;
        this._respectiveReserve = range.calcRespectiveReserve();

        return this._respectiveReserve;
    }

    public takeWorst(): InventoryTick | undefined {
        if (this.isEmpty()) return undefined;

        const range = this.isBase()
            ? this.ranges[0]
            : this.ranges[this.ranges.length - 1];

        const result = range.takeWorst();

        if (range.isEmpty()) {
            if (this.isBase()) this.ranges.shift();
            else this.ranges.pop();
        }

        if (this.ranges.length === 0) {
            this._respectiveReserve = 0;
            this.allocatedQty = 0;
        } else {
            this._respectiveReserve = this.ranges.reduce(
                (prev, cur) => prev + cur.calcRespectiveReserve(),
                0
            );
            this.allocatedQty -= result.qty;
        }

        return {
            inventory: result.qty,
            idx: result.tickIdx,
        };
    }

    public peekWorst(): InventoryTick | undefined {
        if (this.isEmpty()) return undefined;

        const range = this.isBase()
            ? this.ranges[0]
            : this.ranges[this.ranges.length - 1];
        const result = range.peekWorst();

        return {
            inventory: result.qty,
            idx: result.tickIdx,
        };
    }

    public putWorstNewRange(tick: InventoryTick) {
        const respectiveValue =
            tick.inventory *
            absoluteTickToPrice(tick.idx, this._side, "inventory");

        this._respectiveReserve += respectiveValue;
        this.allocatedQty += tick.inventory;

        const range = new InventoryRange(
            tick.inventory,
            tick.idx,
            tick.idx,
            this.side,
            this.noLogs,
            this.isDrifting
        );

        if (this.isBase()) {
            this.ranges.unshift(range);
        } else {
            this.ranges.push(range);
        }

        return;
    }

    public takeBest(curTickIdx: number): InventoryTick | undefined {
        if (this.isEmpty()) return undefined;

        const range = this.isBase()
            ? this.ranges[this.ranges.length - 1]
            : this.ranges[0];

        // IL ranges can have voids in between
        // check if the best is the same as the provided one, otherwise return undefined
        if (range.peekBest().tickIdx !== curTickIdx) {
            return undefined;
        }

        const result = range.takeBest();

        if (range.isEmpty()) {
            if (this.isBase()) this.ranges.pop();
            else this.ranges.shift();
        }

        if (this.ranges.length === 0) {
            this._respectiveReserve = 0;
            this.allocatedQty = 0;
        } else {
            this._respectiveReserve = this.ranges.reduce(
                (prev, cur) => prev + cur.calcRespectiveReserve(),
                0
            );
            this.allocatedQty -= result.qty;
        }

        return {
            inventory: result.qty,
            idx: result.tickIdx,
        };
    }

    public peekBest(): InventoryTick | undefined {
        if (this.isEmpty()) return undefined;

        const range = this.isBase()
            ? this.ranges[this.ranges.length - 1]
            : this.ranges[0];
        const result = range.peekBest();

        return {
            inventory: result.qty,
            idx: result.tickIdx,
        };
    }

    public putBest(tick: InventoryTick) {
        const respectiveValue =
            tick.inventory *
            absoluteTickToPrice(tick.idx, this._side, "inventory");
        this._respectiveReserve += respectiveValue;
        this.allocatedQty += tick.inventory;

        if (this.shouldSpawnNew) {
            const range = new InventoryRange(
                tick.inventory,
                tick.idx,
                tick.idx,
                this.side,
                this.noLogs,
                this.isDrifting
            );

            this.shouldSpawnNew = false;

            if (this.isBase()) {
                this.ranges.push(range);
            } else {
                this.ranges.unshift(range);
            }

            return;
        }

        this.assertNotEmpty();

        const range = this.isBase()
            ? this.ranges[this.ranges.length - 1]
            : this.ranges[0];
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

    public get side() {
        return this._side;
    }

    public isEmpty() {
        return this.ranges.length === 0;
    }

    public isBase() {
        return this._side === "base";
    }

    public getRanges() {
        return this.ranges.map((it) => it.clone(this.noLogs));
    }

    private assertNotEmpty() {
        if (this.isEmpty()) panic("The inventory is empty");
    }
}

export class Liquidity {
    private _reserve: Reserve;
    private _inventory: Inventory;

    constructor(
        private _side: Side,
        private noLogs: boolean,
        private isDrifting: boolean
    ) {
        this._reserve = new Reserve(_side, noLogs, isDrifting);
        this._inventory = new Inventory(_side, noLogs, isDrifting);
    }

    public clone(noLogs: boolean) {
        const l = new Liquidity(this._side, noLogs, this.isDrifting);

        l._reserve = this._reserve.clone(noLogs);
        l._inventory = this._inventory.clone(noLogs);

        return l;
    }

    public init(
        reserveQty: number,
        inventoryQty: number,
        curTickIdx: number,
        tickSpan?: number
    ) {
        const reserveRight = this.isBase()
            ? tickSpan
                ? curTickIdx + tickSpan + 1
                : MAX_TICK
            : curTickIdx - 1;

        const reserveLeft = this.isBase()
            ? curTickIdx + 1
            : tickSpan
            ? curTickIdx - 1 - tickSpan
            : MIN_TICK;

        const inventoryLeft = this.isBase()
            ? tickSpan
                ? curTickIdx - 1 - tickSpan
                : MIN_TICK
            : curTickIdx + 1;

        const inventoryRight = this.isBase()
            ? curTickIdx - 1
            : tickSpan
            ? curTickIdx + tickSpan + 1
            : MAX_TICK;

        this._reserve.init(reserveQty, reserveLeft, reserveRight);

        return this._inventory.init(
            inventoryQty,
            inventoryLeft,
            inventoryRight
        );
    }

    public driftReserve(targetWorst: number) {
        this._reserve.driftWorst(targetWorst);
    }

    public obtainInventoryTick(
        reserveTick: ReserveTick | undefined,
        curTickIdx: number
    ): InventoryTick | undefined {
        if (reserveTick) {
            if (!this._reserve.isInitted()) {
                this._reserve.init(
                    reserveTick.reserve,
                    reserveTick.idx,
                    reserveTick.idx
                );
                this._inventory.notifyReserveChanged();
            } else {
                this._reserve.putBest(reserveTick.reserve);
                this._inventory.notifyReserveChanged();
            }
        } else {
            if (this._reserve.isInitted()) {
                this._reserve.putBest(0);
                this._inventory.notifyReserveChanged();
            }
        }

        return this._inventory.takeBest(curTickIdx);
    }

    public obtainReserveTick(
        inventoryTick: InventoryTick | undefined
    ): ReserveTick | undefined {
        if (inventoryTick) this._inventory.putBest(inventoryTick);

        if (!this._reserve.isInitted()) return undefined;
        const tick = this._reserve.takeBest();

        return tick;
    }

    public get reserve() {
        return this._reserve;
    }

    public get inventory() {
        return this._inventory;
    }

    public isBase() {
        return this._side === "base";
    }

    public get side() {
        return this._side;
    }
}
