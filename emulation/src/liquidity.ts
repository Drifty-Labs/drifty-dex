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
     * Takes the best (closest to the current) tick from the reserve range.
     * @returns The best reserve tick, or `undefined` if the reserve is not initialized.
     */
    public takeBest(): ReserveTick | undefined {
        if (!this.isInitted()) return undefined;

        const result = this.range!.takeBest();

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
     * Adds a new inventory range for the worst (lowest price) tick.
     * @param tick The inventory tick to add.
     */
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

    /**
     * Adds an inventory tick to the best (highest price) range.
     * If `shouldSpawnNew` is true, a new range is created.
     * @param tick The inventory tick to add.
     */
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
