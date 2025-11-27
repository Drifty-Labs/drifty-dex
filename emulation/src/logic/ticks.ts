import { BASE_PRICE, MAX_TICK, MIN_TICK, panic } from "./utils.ts";

/**
 * Factory for producing ticks with a preset orientation (normal for base,
 * inverted for quote). Keeps the main code agnostic to which side it is
 * dealing with while still sharing the same logic.
 */
export class TickIndexFactory {
    constructor(private isBase: boolean) {}

    /**
     * Creates a new `TickIndex` with the factory's orientation.
     * @param idx The absolute index of the tick.
     * @returns A new `TickIndex` instance.
     */
    public make(idx: number): TickIndex {
        // Convert absolute index to relative index
        return new TickIndex(this.isBase, this.isBase ? -idx : idx);
    }

    /**
     * Creates a new `TickIndex` representing the minimum possible tick.
     * @returns A new `TickIndex` instance.
     */
    public min(): TickIndex {
        // Inverted min is -MAX_TICK (relative)
        return new TickIndex(this.isBase, this.isBase ? -MAX_TICK : MIN_TICK);
    }

    /**
     * Creates a new `TickIndex` representing the maximum possible tick.
     * @returns A new `TickIndex` instance.
     */
    public max(): TickIndex {
        // Inverted max is -MIN_TICK (relative)
        return new TickIndex(this.isBase, this.isBase ? -MIN_TICK : MAX_TICK);
    }
}

/**
 * Log-price coordinate used everywhere in the simulator. `isInverted`
 * guarantees that “left of price” always means reserve and “right of price”
 * always means inventory, regardless of whether we are looking at the base or
 * quote side.
 *
 * Prices follow `BASE_PRICE ^ index` where `index` is the *relative* index.
 * - For Base AMM (Normal): Relative Index = Absolute Index.
 * - For Quote AMM (Inverted): Relative Index = -Absolute Index.
 *
 * This ensures that `inc()` always increases the local price and moves "right",
 * and `dec()` always decreases the local price and moves "left".
 */
export class TickIndex {
    /**
     * Clones the tick index, optionally flipping its orientation.
     * Maintains the same *absolute* index.
     * @param invert If `true`, the new tick index will have the opposite orientation.
     */
    public clone(invert?: boolean): TickIndex {
        const newInverted = invert ? !this.isBase : this.isBase;
        const abs = this.toAbsolute();
        // Convert absolute back to relative for the new orientation
        const newIdx = newInverted ? -abs : abs;

        return new TickIndex(newInverted, newIdx);
    }

    /**
     * Creates a new `TickIndex` representing the minimum possible tick with the same orientation.
     * @returns A new `TickIndex` instance.
     */
    public min(): TickIndex {
        return new TickIndex(this.isBase, this.isBase ? -MAX_TICK : MIN_TICK);
    }

    /**
     * Calculates the price at this tick.
     * The price is calculated as `BASE_PRICE ^ relative_index`.
     * @returns The price at this tick.
     */
    public get price(): number {
        return Math.pow(BASE_PRICE, this.idx);
    }

    /**
     * Calculates the distance between this tick and another tick.
     * @param to The other tick.
     * @returns The distance between the ticks.
     */
    public distance(to: TickIndex): number {
        this.assertSameOrientation(to);

        return Math.abs(this.idx - to.idx);
    }

    /**
     * Checks if this tick is equal to another tick.
     * @param to The other tick.
     * @returns `true` if the ticks are equal, `false` otherwise.
     */
    public eq(to: TickIndex): boolean {
        this.assertSameOrientation(to);

        return this.idx === to.idx;
    }

    /**
     * Checks if this tick is less than another tick.
     * @param to The other tick.
     * @returns `true` if this tick is less than the other tick, `false` otherwise.
     */
    public lt(to: TickIndex): boolean {
        this.assertSameOrientation(to);

        return this.idx < to.idx;
    }

    /**
     * Checks if this tick is less than or equal to another tick.
     * @param to The other tick.
     * @returns `true` if this tick is less than or equal to the other tick, `false` otherwise.
     */
    public le(to: TickIndex): boolean {
        this.assertSameOrientation(to);

        return this.idx <= to.idx;
    }

    /**
     * Checks if this tick is greater than another tick.
     * @param to The other tick.
     * @returns `true` if this tick is greater than the other tick, `false` otherwise.
     */
    public gt(to: TickIndex): boolean {
        this.assertSameOrientation(to);

        return this.idx > to.idx;
    }

    /**
     * Checks if this tick is greater than or equal to another tick.
     * @param to The other tick.
     * @returns `true` if this tick is greater than or equal to the other tick, `false` otherwise.
     */
    public ge(to: TickIndex): boolean {
        this.assertSameOrientation(to);

        return this.idx >= to.idx;
    }

    /** Moves one tick to the right (higher local price). */
    public inc() {
        this.idx++;
        this.assertInRange();

        return this;
    }

    /** Moves one tick to the left (lower local price). */
    public dec() {
        this.idx--;
        this.assertInRange();

        return this;
    }

    /**
     * Adds a specified amount to the tick index.
     * Positive values move right (increase local price).
     * @param amount The amount to add to the tick index.
     */
    public add(amount: number) {
        this.idx += amount;
        this.assertInRange();

        return this;
    }

    /**
     * Subtracts a specified amount from the tick index.
     * Positive values move left (decrease local price).
     * @param amount The amount to subtract from the tick index.
     */
    public sub(amount: number) {
        this.idx -= amount;
        this.assertInRange();

        return this;
    }

    /**
     * Converts the tick index to its absolute value.
     * @returns The absolute tick index.
     */
    public toAbsolute(): number {
        return this.isBase ? -this.idx : this.idx;
    }

    /**
     * Gets the raw relative index of the tick.
     * @returns The tick index.
     */
    public index(): number {
        return this.idx;
    }

    /**
     * Checks if the tick has an inverted orientation (true means this tick index should be used for base asset).
     * @returns `true` if inverted, `false` otherwise.
     */
    public isBaseTick(): boolean {
        return this.isBase;
    }

    /**
     * Creates a new `TickIndex`.
     * @param isBase Whether the tick has an inverted orientation.
     * @param idx The relative index of the tick.
     */
    constructor(private isBase: boolean, private idx: number) {
        this.assertInRange();
    }

    private assertSameOrientation(other: TickIndex) {
        if (this.isBase !== other.isBase)
            panic("Ticks are of different orientation");
    }

    private assertInRange() {
        // Check bounds on the absolute value
        const abs = this.toAbsolute();
        if (abs < MIN_TICK)
            panic(`The tick ${abs} is lower than min tick ${MIN_TICK}`);
        if (abs > MAX_TICK)
            panic(`The tick ${abs} is higher than max tick ${MAX_TICK}`);
    }
}
