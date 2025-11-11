import { BASE_PRICE, MAX_TICK, MIN_TICK, panic } from "./utils.ts";

export class TickIndexFactory {
    constructor(private isInverted: boolean) {}

    public make(idx: number): TickIndex {
        return new TickIndex(this.isInverted, idx);
    }

    public min(): TickIndex {
        return new TickIndex(this.isInverted, MIN_TICK);
    }

    public max(): TickIndex {
        return new TickIndex(this.isInverted, MAX_TICK);
    }
}

export class TickIndex {
    public clone(): TickIndex {
        return new TickIndex(this.isInverted, this.idx);
    }

    public getPrice(): number {
        return Math.pow(BASE_PRICE, this.toAbsolute());
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
        if (this.isInverted) this.idx -= 1;
        else this.idx += 1;

        this.assertInRange();
    }

    public dec() {
        if (this.isInverted) this.idx += 1;
        else this.idx -= 1;

        this.assertInRange();
    }

    public toAbsolute(): number {
        return this.isInverted ? -this.idx : this.idx;
    }

    public index(): number {
        return this.idx;
    }

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
