import { BASE_PRICE, MAX_TICK, MIN_TICK, panic } from "./utils.ts";

export class TickIndexFactory {
    constructor(private isBase: boolean) {}

    public make(idx: number): TickIndex {
        return new TickIndex(this.isBase, this.isBase ? -idx : idx);
    }

    public min(): TickIndex {
        return new TickIndex(this.isBase, this.isBase ? -MAX_TICK : MIN_TICK);
    }

    public max(): TickIndex {
        return new TickIndex(this.isBase, this.isBase ? -MIN_TICK : MAX_TICK);
    }
}

export class TickIndex {
    public clone(invert?: boolean): TickIndex {
        const newInverted = invert ? !this.isBase : this.isBase;
        const abs = this.toAbsolute();
        // Convert absolute back to relative for the new orientation
        const newIdx = newInverted ? -abs : abs;

        return new TickIndex(newInverted, newIdx);
    }

    public min(): TickIndex {
        return new TickIndexFactory(this.isBase).min();
    }

    public max(): TickIndex {
        return new TickIndexFactory(this.isBase).max();
    }

    public get price(): number {
        return Math.pow(BASE_PRICE, this.idx);
    }

    public distance(to: TickIndex): number {
        this.assertSameOrientation(to);

        return Math.abs(this.idx - to.idx);
    }

    public eq(to: TickIndex): boolean {
        this.assertSameOrientation(to);

        return this.idx === to.idx;
    }

    public lt(to: TickIndex): boolean {
        this.assertSameOrientation(to);

        return this.idx < to.idx;
    }

    public le(to: TickIndex): boolean {
        this.assertSameOrientation(to);

        return this.idx <= to.idx;
    }

    public gt(to: TickIndex): boolean {
        this.assertSameOrientation(to);

        return this.idx > to.idx;
    }

    public ge(to: TickIndex): boolean {
        this.assertSameOrientation(to);

        return this.idx >= to.idx;
    }

    public inc() {
        this.idx++;
        this.assertInRange();

        return this;
    }

    public dec() {
        this.idx--;
        this.assertInRange();

        return this;
    }

    public add(amount: number) {
        this.idx += amount;
        this.assertInRange();

        return this;
    }

    public sub(amount: number) {
        this.idx -= amount;
        this.assertInRange();

        return this;
    }

    public toAbsolute(): number {
        return this.isBase ? -this.idx : this.idx;
    }

    public index(): number {
        return this.idx;
    }

    public isBaseTick(): boolean {
        return this.isBase;
    }

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
