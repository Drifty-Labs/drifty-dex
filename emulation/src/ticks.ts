import { BASE_PRICE, MAX_TICK, MIN_TICK, panic } from "./utils.ts";

/**
 * Factory for producing ticks with a preset orientation (normal for base,
 * inverted for quote). Keeps the main code agnostic to which side it is
 * dealing with while still sharing the same logic.
 */
export class TickIndexFactory {
    constructor(private isInverted: boolean) {}

    /**
     * Creates a new `TickIndex` with the factory's orientation.
     * @param idx The index of the tick.
     * @returns A new `TickIndex` instance.
     */
    public make(idx: number): TickIndex {
        return new TickIndex(this.isInverted, idx);
    }

    /**
     * Creates a new `TickIndex` representing the minimum possible tick.
     * @returns A new `TickIndex` instance.
     */
    public min(): TickIndex {
        return new TickIndex(this.isInverted, MIN_TICK);
    }

    /**
     * Creates a new `TickIndex` representing the maximum possible tick.
     * @returns A new `TickIndex` instance.
     */
    public max(): TickIndex {
        return new TickIndex(this.isInverted, MAX_TICK);
    }
}

/**
 * Log-price coordinate used everywhere in the simulator. `isInverted`
 * guarantees that “left of price” always means reserve and “right of price”
 * always means inventory, regardless of whether we are looking at the base or
 * quote side.
 *
 * Prices follow `BASE_PRICE ^ index` where `index` is the orientation-aware
 * value ({@link toAbsolute}). This keeps math consistent when stable and
 * drifting AMMs march in opposite directions.
 */
export class TickIndex {
    /**
     * Clones the tick index, optionally flipping its orientation. Handy when we
     * need the “mirror” tick for the opposite AMM side.
     * @param invert If `true`, the new tick index will have the opposite orientation.
     */
    public clone(invert?: boolean): TickIndex {
        return new TickIndex(
            invert ? !this.isInverted : this.isInverted,
            this.idx
        );
    }

    /**
     * Creates a new `TickIndex` representing the minimum possible tick with the same orientation.
     * @returns A new `TickIndex` instance.
     */
    public min(): TickIndex {
        return new TickIndex(this.isInverted, MIN_TICK);
    }

    /**
     * Calculates the price at this tick.
     * The price is calculated as `BASE_PRICE ^ tick_index`.
     * @returns The price at this tick.
     */
    public getPrice(): number {
        return Math.pow(BASE_PRICE, this.toAbsolute());
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

    /** Moves one tick to the right (higher price for inventory). */
    public inc() {
        if (this.isInverted) this.idx -= 1;
        else this.idx += 1;

        this.assertInRange();
    }

    /** Moves one tick to the left (higher price for reserve). */
    public dec() {
        if (this.isInverted) this.idx += 1;
        else this.idx -= 1;

        this.assertInRange();
    }

    /**
     * Converts the tick index to its absolute value.
     * This is used for price calculations, as the price is always positive.
     * @returns The absolute tick index.
     */
    public toAbsolute(): number {
        return this.isInverted ? -this.idx : this.idx;
    }

    /**
     * Gets the raw index of the tick.
     * @returns The tick index.
     */
    public index(): number {
        return this.idx;
    }

    /**
     * Creates a new `TickIndex`.
     * @param isInverted Whether the tick has an inverted orientation.
     * @param idx The index of the tick.
     */
    constructor(private isInverted: boolean, private idx: number) {
        this.assertInRange();
    }

    private assertSameOrientation(other: TickIndex) {
        if (this.isInverted !== other.isInverted)
            panic("Ticks are of different orientation");
    }

    private assertInRange() {
        if (this.idx < MIN_TICK) panic("The tick is lower than min tick");
        if (this.idx > MAX_TICK) panic("The tick is higher than max tick");
    }
}
