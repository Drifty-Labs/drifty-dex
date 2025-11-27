import { InventoryRange, ReserveRange, type TakeResult } from "./range.ts";
import { TickIndex } from "./ticks.ts";
import { almostEq, panic } from "./utils.ts";

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

/**
 * Manages the reserve liquidity that sits idle to the left of the current
 * price. Reserve liquidity is uniform across its range and supplies the next
 * {@link CurrentTick} whenever the active tick needs more depth.
 */
export class Reserve {
    private range: ReserveRange | undefined = undefined;

    public clone() {
        const r = new Reserve();
        r.range = this.range?.clone();

        return r;
    }

    /**
     * Initializes the reserve with a given amount of liquidity and range.
     * Stable AMMs call this once (MIN_TICK to current), while drifting AMMs
     * are reinitialized by external orchestrators to match their moving window.
     *
     * Always call Inventory.notifyReserveChanged after calling this function
     */
    public init(qty: number, left: TickIndex, right: TickIndex) {
        this.assertNotInitted();

        this.range = new ReserveRange(qty, left, right);
    }

    /**
     * Withdraws a cut of the reserve liquidity.
     * @param cut The percentage of the reserve to withdraw (0 to 1).
     * @returns The amount of reserve withdrawn.
     */
    public withdrawCut(cut: number): number {
        this.assertInitted();

        return this.range!.withdrawCut(cut);
    }

    /**
     * Adds liquidity to the reserve range.
     * Always call Inventory.notifyReserveChange, after calling this method
     *
     * @param qty The amount of liquidity to add.
     */
    public putUniform(qty: number) {
        this.assertInitted();

        this.range!.put(qty);
    }

    /**
     * Adds liquidity to the reserve range and stretches it one tick to the right
     *
     * Always call Inventory.notifyReserveChange, after calling this method
     *
     * @param qty
     * @param curTickIdx
     */
    public putRight(qty: number) {
        this.assertInitted();

        this.range!.putBest(qty);
    }

    /**
     * Takes the best (closest to the current) tick from the reserve range.
     * @returns The best reserve tick, or `undefined` if the reserve is not initialized.
     */
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

    /**
     * Peeks at the best (closest to the current) tick from the reserve range.
     * @returns The best reserve tick, or `undefined` if the reserve is not initialized.
     */
    public peekRight(): ReserveTick | undefined {
        if (!this.isInitted()) return undefined;

        const result = this.range!.peekBest();

        return {
            reserve: result.qty,
            idx: result.tickIdx,
        };
    }

    /**
     * Rebases the reserve range to a new left bound.
     * @param newLeft The new left bound.
     */
    public driftLeft(newLeft: TickIndex) {
        this.assertInitted();
        this.range!.setLeft(newLeft);
    }

    /**
     * Peeks at the left tick of the reserve range.
     * @returns The left most reserve tick, or `undefined` if the reserve is not initialized.
     */
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

    /**
     * Gets the width of the reserve range (number of ticks).
     */
    public get width(): number {
        this.assertInitted();

        return this.range!.width;
    }

    /**
     * Gets the total quantity of liquidity in the reserve.
     */
    public get qty(): number {
        this.assertInitted();

        return this.range!.getQty();
    }

    /**
     * Checks if the reserve has been initialized.
     * @returns `true` if the reserve is initialized, `false` otherwise.
     */
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

/**
 * Represents a tick with a certain amount of inventory liquidity.
 */
export type InventoryTick = {
    /** The amount of inventory liquidity. */
    inventory: number;
    /** The index of the tick. */
    idx: TickIndex;
};

/**
 * Tracks swap-generated liquidity to the right of the current price. Inventory
 * buckets correspond to concentrated LP positions that the AMM acquired while
 * filling trades. Each bucket remembers how much reserve was spent so IL can be
 * measured and unwound fairly.
 */
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

    /**
     * Takes the worst (lowest price) inventory tick from the inventory.
     * @returns The worst inventory tick, or `undefined` if the inventory is empty.
     */
    public takeRight(): InventoryTick | undefined {
        if (this.isEmpty()) return undefined;

        const range = this.ranges[this.ranges.length - 1];
        const result = range.takeWorst();

        if (range.isEmpty()) {
            this.ranges.pop();
        }

        this.allocatedQty -= result.qty;
        this._respectiveReserve -= result.qty / result.tickIdx.price;

        return {
            inventory: result.qty,
            idx: result.tickIdx,
        };
    }

    /**
     * Peeks at the worst (lowest price) inventory tick without removing it.
     * @returns The worst inventory tick, or `undefined` if the inventory is empty.
     */
    public peekRight(): InventoryTick | undefined {
        if (this.isEmpty()) return undefined;

        const range = this.ranges[this.ranges.length - 1];
        const result = range.peekWorst();

        return {
            inventory: result.qty,
            idx: result.tickIdx,
        };
    }

    /**
     * Adds a new inventory range for the worst (lowest price) tick.
     * @param tick The inventory tick to add.
     */
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

        this._respectiveReserve += tick.inventory / tick.idx.price;
        this.allocatedQty += tick.inventory;

        const range = new InventoryRange(
            tick.inventory,
            tick.idx,
            tick.idx.clone()
        );
        this.ranges.push(range);

        return;
    }

    /**
     * Takes the best (highest price) inventory tick that matches the current tick.
     * @param curTickIdx The current tick index.
     * @returns The best inventory tick, or `undefined` if no matching tick is found.
     */
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
        this._respectiveReserve -= result.qty / result.tickIdx.price;

        return {
            inventory: result.qty,
            idx: result.tickIdx,
        };
    }

    /**
     * Peeks at the best (highest price) inventory tick without removing it.
     * @returns The best inventory tick, or `undefined` if the inventory is empty.
     */
    public peekLeft(): InventoryTick | undefined {
        if (this.isEmpty()) return undefined;

        const range = this.ranges[0];
        const result = range.peekBest();

        return {
            inventory: result.qty,
            idx: result.tickIdx,
        };
    }

    /**
     * Adds an inventory tick to the best (highest price) range.
     * If `shouldSpawnNew` is true, a new range is created.
     * @param tick The inventory tick to add.
     */
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

        this._respectiveReserve += tick.inventory / tick.idx.price;
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

    /**
     * Notifies the inventory that the reserve has changed.
     * This typically triggers the creation of a new inventory range on the next `putBest` call.
     */
    public notifyReserveChanged() {
        this.shouldSpawnNew = true;
    }

    /**
     * Gets the total amount of reserve that was spent to acquire the current inventory.
     * @returns The respective reserve amount.
     */
    public get respectiveReserve() {
        return this._respectiveReserve;
    }

    /**
     * Gets the total quantity of inventory held by the AMM.
     * @returns The total inventory quantity.
     */
    public get qty() {
        return this.allocatedQty;
    }

    /**
     * Checks if the inventory is empty.
     * @returns `true` if the inventory is empty, `false` otherwise.
     */
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

    /**
     * Gets the inventory ranges.
     * @returns An array of inventory ranges.
     */
    public getRanges(): InventoryRange[] {
        return this.ranges;
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
        tickSpan: number
    ) {
        const reserveLeft = curTickIdx.clone().sub(tickSpan);
        const reserveRight = curTickIdx.clone().dec();

        const inventoryLeft = curTickIdx.clone().inc();
        const inventoryRight = curTickIdx.clone().add(tickSpan);

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
