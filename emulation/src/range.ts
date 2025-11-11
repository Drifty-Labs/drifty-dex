import { TickIndex } from "./ticks.ts";
import { BASE_PRICE, panic } from "./utils.ts";

export type TakeResult = {
    qty: number;
    tickIdx: TickIndex;
};

export abstract class Range {
    constructor(
        protected qty: number,
        protected left: TickIndex, // inclusive
        protected right: TickIndex // inclusive
    ) {}

    public abstract takeBest(): TakeResult;

    public abstract takeWorst(): TakeResult;

    get width() {
        if (this.right.le(this.left))
            panic(
                `The range has invalid bounds [${this.left.index()}, ${this.right.index()}]`
            );

        return this.right.distance(this.left) + 1;
    }

    public isEmpty() {
        const empty = this.width === 0;
        if (empty && this.qty > 0)
            panic(
                `The range is empty, but there is still ${this.qty} liquidity`
            );

        return empty;
    }

    protected assertNonEmpty() {
        if (this.isEmpty())
            panic(
                "An empty range should be disposed and re-created later again"
            );
    }
}

export class ReserveRange extends Range {
    constructor(qty: number, left: TickIndex, right: TickIndex) {
        if (left.gt(right))
            panic(
                `The range has invalid bounds [${left.index()}, ${right.index()}]`
            );

        super(qty, left, right);
    }

    public put(qty: number) {
        this.qty += qty;
    }

    public override takeBest(): TakeResult {
        this.assertNonEmpty();

        const qty = this.qty / this.width;
        this.qty -= qty;

        const tick = this.right.clone();
        this.right.dec();

        return { qty, tickIdx: tick };
    }

    public override takeWorst(): TakeResult {
        this.assertNonEmpty();

        const qty = this.qty / this.width;
        this.qty -= qty;

        const tick = this.left.clone();
        this.left.inc();

        return { qty, tickIdx: tick };
    }

    public stretchToRight(newRight: TickIndex) {
        this.assertNonEmpty();

        if (newRight.le(this.right))
            panic(
                `New right ${newRight.index()} should be bigger than old right ${this.right.index()}`
            );

        this.right = newRight.clone();
    }
}

export class InventoryRange extends Range {
    constructor(qty: number, left: TickIndex, right: TickIndex) {
        if (left.gt(right))
            panic(
                `The range has invalid bounds [${left.index()}, ${right.index()}]`
            );

        super(qty, left, right);
    }

    public override takeBest(): TakeResult {
        this.assertNonEmpty();

        const qty = this.bestTickQty();
        this.qty -= qty;

        const tick = this.left.clone();
        this.left.inc();

        return { qty, tickIdx: tick };
    }

    public override takeWorst(): TakeResult {
        this.assertNonEmpty();

        const qty = this.worstTickQty();
        this.qty -= qty;

        const tick = this.right.clone();
        this.right.dec();

        return { qty, tickIdx: tick };
    }

    public putBest(qty: number, curTick: TickIndex) {
        this.assertNonEmpty();

        this.qty += qty;
        this.left.dec();

        if (!this.left.eq(curTick)) panic("Invalid inventory cur tick");
    }

    private bestTickQty() {
        return (
            (this.qty * (BASE_PRICE - 1)) /
            (Math.pow(BASE_PRICE, this.width) - 1)
        );
    }

    private worstTickQty() {
        return this.bestTickQty() * Math.pow(BASE_PRICE, this.width - 1);
    }
}
