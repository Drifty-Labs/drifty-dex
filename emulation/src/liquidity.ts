import { InventoryRange, ReserveRange } from "./range.ts";
import { TickIndex } from "./ticks.ts";
import { panic } from "./utils.ts";

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
     * Takes the best (closest to the current) tick from the reserve range.
     * @param curTickIdx The current tick index.
     * @returns The best reserve tick, or `undefined` if the reserve is not initialized.
     */
    public takeBest(curTickIdx: TickIndex): ReserveTick | undefined {
        if (!this.isInitted()) return undefined;

        const bestTick = this.range!.peekBest();
        
        if (!bestTick.tickIdx.eq(curTickIdx)) {
            return undefined;
        }

        const result = this.range!.takeBest();

        return {
            reserve: result.qty,
            idx: result.tickIdx,
        };
    }

    /**
     * Peeks at the best (closest to the current) tick from the reserve range.
     * @returns The best reserve tick, or `undefined` if the reserve is not initialized.
     */
    public peekBest(): ReserveTick | undefined {
        if (!this.isInitted()) return undefined;

        const result = this.range!.peekBest();

        return {
            reserve: result.qty,
            idx: result.tickIdx,
        };
    }

    /**
     * Takes the worst (furthest from the current) tick from the reserve range.
     * @returns The worst reserve tick, or `undefined` if the reserve is not initialized.
     */
    public takeWorst(): ReserveTick | undefined {
        if (!this.isInitted()) return undefined;

        const result = this.range!.takeWorst();

        return {
            reserve: result.qty,
            idx: result.tickIdx,
        };
    }

    /**
     * Peeks at the worst (furthest from the current) tick from the reserve range.
     * @returns The worst reserve tick, or `undefined` if the reserve is not initialized.
     */
    public peekWorst(): ReserveTick | undefined {
        if (!this.isInitted()) return undefined;

        const result = this.range!.peekWorst();

        return {
            reserve: result.qty,
            idx: result.tickIdx,
        };
    }

    /**
     * Stretches the reserve range to the current tick.
     * This is used to expand the range of the reserve to include the current price.
     * @param curTickIdx The current tick index.
     */
    public stretchToCurTick(curTickIdx: TickIndex) {
        this.assertInitted();
        this.range!.stretchToRight(curTickIdx);
    }

    /**
     * Adds liquidity to the reserve range.
     * @param qty The amount of liquidity to add.
     */
    public put(qty: number) {
        this.assertInitted();

        this.range!.put(qty);
    }

    /**
     * Initializes the reserve with a given amount of liquidity and range.
     * Stable AMMs call this once (MIN_TICK to current), while drifting AMMs
     * are reinitialized by external orchestrators to match their moving window.
     */
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

    /**
     * Checks if the reserve has been initialized.
     * @returns `true` if the reserve is initialized, `false` otherwise.
     */
    public isInitted() {
        return this.range !== undefined;
    }

    /**
     * Rebases the reserve range to a new left bound.
     * @param newLeft The new left bound.
     */
    public rebase(newLeft: TickIndex) {
        this.assertInitted();
        this.range!.setLeft(newLeft);
    }

    /**
     * Gets the left bound of the reserve range.
     * @returns The left bound tick index.
     */
    public getLeft(): TickIndex {
        this.assertInitted();
        return this.range!.getLeft();
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
    private respectiveReserve: number = 0;
    private allocatedQty: number = 0;
    private shouldSpawnNew: boolean = true;
    private ranges: InventoryRange[] = [];

    /**
     * Gets the total amount of reserve that was spent to acquire the current inventory.
     * @returns The respective reserve amount.
     */
    public getRespectiveReserve() {
        return this.respectiveReserve;
    }

    /**
     * Gets the total quantity of inventory held by the AMM.
     * @returns The total inventory quantity.
     */
    public qty() {
        return this.allocatedQty;
    }

    /**
     * Takes the best (highest price) inventory tick that matches the current tick.
     * @param curTickIdx The current tick index.
     * @returns The best inventory tick, or `undefined` if no matching tick is found.
     */
    public takeBest(curTickIdx: TickIndex): InventoryTick | undefined {
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

        const unusedReserve = result.qty / result.tickIdx.getPrice();
        this.respectiveReserve -= unusedReserve;

        return {
            inventory: result.qty,
            idx: result.tickIdx,
        };
    }

    /**
     * Peeks at the best (highest price) inventory tick without removing it.
     * @returns The best inventory tick, or `undefined` if the inventory is empty.
     */
    public peekBest(): InventoryTick | undefined {
        if (this.isEmpty()) return undefined;

        const range = this.ranges[0];
        const result = range.peekBest();

        return {
            inventory: result.qty,
            idx: result.tickIdx,
        };
    }

    /**
     * Takes the worst (lowest price) inventory tick from the inventory.
     * @returns The worst inventory tick, or `undefined` if the inventory is empty.
     */
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

    /**
     * Peeks at the worst (lowest price) inventory tick without removing it.
     * @returns The worst inventory tick, or `undefined` if the inventory is empty.
     */
    public peekWorst(): InventoryTick | undefined {
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
    public putWorstNewRange(tick: InventoryTick) {
        // Invariant: New worst must be strictly greater (further right) than current worst
        if (!this.isEmpty()) {
            const currentWorst = this.peekWorst();
            if (currentWorst && !tick.idx.gt(currentWorst.idx)) {
                panic(`Inventory invariant violated: New worst tick ${tick.idx.index()} must be greater than current worst ${currentWorst.idx.index()}`);
            }
        }

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

    /**
     * Adds an inventory tick to the best (highest price) range.
     * If `shouldSpawnNew` is true, a new range is created.
     * @param tick The inventory tick to add.
     */
    public putBest(tick: InventoryTick) {
        // Invariant: New best must be strictly less (further left) than current best
        // if we are NOT spawning a new range (i.e., we are extending the current best range).
        // If we ARE spawning a new range, it must still be "better" (closer to price/lower index) than the old best.
        // Actually, `putBest` is used when we move Left (Price Decreases).
        // We put ticks that are now to the Right of Price.
        // The ticks we put are progressively Lower (101, 100, 99...).
        // So the new tick should be LESS than the previous best?
        // Wait. Inventory is Right of Price.
        // Best = Lowest Index (Closest to Price).
        // If we put 101, then 100. 100 < 101.
        // So new tick < current best.
        
        if (!this.isEmpty()) {
            // We need to peek the current best to check.
            // But we don't have a cheap peekBest across all ranges easily exposed?
            // ranges[0] is the best range.
            const bestRange = this.ranges[0];
            // bestTickIdx() returns the lowest index (Best).
            const currentBestIdx = bestRange.bestTickIdx();
            
            if (!tick.idx.lt(currentBestIdx)) {
                 panic(`Inventory invariant violated: New best tick ${tick.idx.index()} must be less than current best ${currentBestIdx.index()}`);
            }
        }

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

    /**
     * Checks if the inventory is empty.
     * @returns `true` if the inventory is empty, `false` otherwise.
     */
    public isEmpty() {
        return this.ranges.length === 0;
    }

    private assertNotEmpty() {
        if (this.isEmpty()) panic("The inventory is empty");
    }

    /**
     * Notifies the inventory that the reserve has changed.
     * This typically triggers the creation of a new inventory range on the next `putBest` call.
     */
    public notifyReserveChanged() {
        this.shouldSpawnNew = true;
    }
}
