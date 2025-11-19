import { TickIndex } from "./ticks.ts";
import { BASE_PRICE, panic } from "./utils.ts";

/**
 * The result of taking a tick from a range.
 */
export type TakeResult = {
    /** The quantity of liquidity taken. */
    qty: number;
    /** The index of the tick taken. */
    tickIdx: TickIndex;
};

/**
 * An abstract class representing a range of ticks with a certain amount of liquidity.
 * This class provides the base functionality for both `ReserveRange` and `InventoryRange`.
 *
 * The range is defined by a `left` and `right` tick index. The `left` tick is always the one with the lower price,
 * and the `right` tick is the one with the higher price. This is true regardless of the tick orientation.
 */
export abstract class Range {
    /**
     * Creates a new `Range`.
     * @param qty The quantity of liquidity in the range.
     * @param left The left (inclusive) tick index of the range.
     * @param right The right (inclusive) tick index of the range.
     */
    constructor(
        protected qty: number,
        protected left: TickIndex, // inclusive
        protected right: TickIndex // inclusive
    ) {}

    /**
     * Takes the best (closest to the current) tick from the range.
     */
    public abstract takeBest(): TakeResult;

    /**
     * Takes the worst (furthest from the current) tick from the range.
     */
    public abstract takeWorst(): TakeResult;

    /**
     * The width of the range (number of ticks).
     */
    get width() {
        if (this.right.lt(this.left)) return 0;

        return this.right.distance(this.left) + 1;
    }

    /**
     * Checks if the range is empty.
     * @returns `true` if the range is empty, `false` otherwise.
     */
    public isEmpty() {
        const empty = this.width <= 0;
        if (empty && this.qty > 0)
            panic(
                `The range is empty, but there is still ${this.qty} liquidity`
            );

        return empty;
    }

    /**
     * Asserts that the range is not empty.
     */
    protected assertNonEmpty() {
        if (this.isEmpty())
            panic(
                "An empty range should be disposed and re-created later again"
            );
    }
}

/**
 * Represents a range of reserve liquidity.
 * This liquidity is distributed evenly across the ticks in the range.
 *
 * Reserve ranges are always to the left of the current price.
 * Therefore, `takeBest` takes from the right of the range, and `takeWorst` takes from the left.
 */
export class ReserveRange extends Range {
    /**
     * Creates a new `ReserveRange`.
     * @param qty The quantity of liquidity.
     * @param left The left (inclusive) tick of the range.
     * @param right The right (inclusive) tick of the range.
     */
    constructor(qty: number, left: TickIndex, right: TickIndex) {
        if (left.gt(right))
            panic(
                `The range has invalid bounds [${left.index()}, ${right.index()}]`
            );

        super(qty, left, right);
    }

    /**
     * Adds liquidity to the range.
     * @param qty The amount of liquidity to add.
     */
    public put(qty: number) {
        this.qty += qty;
    }

    /**
     * Withdraws a cut of the liquidity from the range.
     * @param cut The percentage of liquidity to withdraw (0 to 1).
     * @returns The amount of liquidity withdrawn.
     */
    public withdrawCut(cut: number): number {
        this.assertNonEmpty();

        const qty = this.qty * cut;
        this.qty -= qty;

        return qty;
    }

    /**
     * Takes the best tick from the range.
     * The liquidity is distributed evenly, so each tick has `qty / width` liquidity.
     * @returns The result of the take operation.
     */
    public override takeBest(): TakeResult {
        this.assertNonEmpty();

        const qty = this.qty / this.width;
        this.qty -= qty;

        const tick = this.right.clone();
        this.right.dec();

        return { qty, tickIdx: tick };
    }

    /**
     * Takes the worst tick from the range.
     * The liquidity is distributed evenly, so each tick has `qty / width` liquidity.
     * @returns The result of the take operation.
     */
    public override takeWorst(): TakeResult {
        this.assertNonEmpty();

        const qty = this.qty / this.width;
        this.qty -= qty;

        const tick = this.left.clone();
        this.left.inc();

        return { qty, tickIdx: tick };
    }

    /**
     * Stretches the range to the right to include a new tick.
     * @param newRight The new right tick of the range.
     */
    public stretchToRight(newRight: TickIndex) {
        this.assertNonEmpty();

        if (newRight.le(this.right))
            panic(
                `New right ${newRight.index()} should be bigger than old right ${this.right.index()}`
            );

        this.right = newRight.clone();
    }
}

/**
 * Represents a range of inventory liquidity.
 * This liquidity is concentrated, meaning it is not distributed evenly across the ticks.
 * The distribution is calculated based on the `BASE_PRICE` to ensure that the value of the inventory remains constant.
 *
 * Inventory ranges are always to the right of the current price.
 * Therefore, `takeBest` takes from the left of the range, and `takeWorst` takes from the right.
 */
export class InventoryRange extends Range {
    /**
     * Creates a new `InventoryRange`.
     * @param qty The quantity of liquidity.
     * @param left The left (inclusive) tick of the range.
     * @param right The right (inclusive) tick of the range.
     */
    constructor(qty: number, left: TickIndex, right: TickIndex) {
        if (left.gt(right))
            panic(
                `The range has invalid bounds [${left.index()}, ${right.index()}]`
            );

        super(qty, left, right);
    }

    /**
     * Takes the best (highest price) tick from the range.
     * @returns The result of the take operation.
     */
    public override takeBest(): TakeResult {
        this.assertNonEmpty();

        if (this.width === 1) {
            const qty = this.qty;
            this.qty = 0;
            const tick = this.left.clone();
            this.left.inc();
            return { qty, tickIdx: tick };
        }

        const qty = this.bestTickQty();
        this.qty -= qty;

        const tick = this.left.clone();
        this.left.inc();

        return { qty, tickIdx: tick };
    }

    /**
     * Gets the index of the best (highest price) tick in the range.
     * @returns The index of the best tick.
     */
    public betTickIdx(): TickIndex {
        this.assertNonEmpty();

        return this.left.clone();
    }

    /**
     * Takes the worst (lowest price) tick from the range.
     * @returns The result of the take operation.
     */
    public override takeWorst(): TakeResult {
        this.assertNonEmpty();

        const qty = this.worstTickQty();
        this.qty -= qty;

        const tick = this.right.clone();
        this.right.dec();

        return { qty, tickIdx: tick };
    }

    /**
     * Adds liquidity to the best (highest price) tick in the range.
     * @param qty The amount of liquidity to add.
     * @param curTick The current tick index.
     */
    public putBest(qty: number, curTick: TickIndex) {
        this.assertNonEmpty();

        this.qty += qty;
        this.left.dec();

        if (!this.left.eq(curTick)) panic("Invalid inventory cur tick");
    }

    /**
     * Calculates the quantity of liquidity in the best (highest price) tick.
     * @returns The quantity of liquidity.
     */
    private bestTickQty() {
        return (
            (this.qty * (BASE_PRICE - 1)) /
            (Math.pow(BASE_PRICE, this.width) - 1)
        );
    }

    /**
     * Calculates the quantity of liquidity in the worst (lowest price) tick.
     * @returns The quantity of liquidity.
     */
    private worstTickQty() {
        return this.bestTickQty() * Math.pow(BASE_PRICE, this.width - 1);
    }
}
