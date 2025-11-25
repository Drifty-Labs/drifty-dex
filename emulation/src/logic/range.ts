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
 * Base helper for managing a contiguous set of ticks that share liquidity.
 * Concrete subclasses decide how liquidity is distributed (uniform for
 * reserves, geometric for inventory) but rely on the same take/width rules.
 */
export abstract class Range {
    constructor(
        protected qty: number,
        protected left: TickIndex,
        protected right: TickIndex
    ) {}

    /** Takes the tick closest to the current price. */
    public abstract takeBest(): TakeResult;
    /** Takes the tick furthest away from price. */
    public abstract takeWorst(): TakeResult;

    public abstract unpack(curTick: TickIndex, tickSpan: number): TakeResult[];

    get width() {
        if (this.right.lt(this.left)) return 0;

        return this.right.distance(this.left) + 1;
    }

    public getQty() {
        return this.qty;
    }

    public isEmpty() {
        const empty = this.width <= 0;
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

/**
 * Uniform-liquidity range used for reserves (left of price). Every tick holds
 * the same amount, so `takeBest` consumes from the closest right boundary while
 * `takeWorst` consumes from the left.
 */
export class ReserveRange extends Range {
    constructor(qty: number, left: TickIndex, right: TickIndex) {
        if (left.gt(right))
            panic(
                `The range has invalid bounds [${left.index()}, ${right.index()}]`
            );

        super(qty, left, right);
    }

    public override unpack(curTick: TickIndex, tickSpan: number): TakeResult[] {
        const result: TakeResult[] = [];

        if (!this.isEmpty()) {
            const q = this.qty / this.width;

            for (const i = this.right.clone(); i.ge(this.left); i.dec()) {
                if (i.distance(curTick) > tickSpan) break;

                result.push({ qty: q, tickIdx: i.clone() });
            }
        }

        return result;
    }

    public put(qty: number) {
        this.assertNonEmpty();
        this.qty += qty;
    }

    public withdrawCut(cut: number): number {
        this.assertNonEmpty();

        const qty = this.qty * cut;
        this.qty -= qty;

        return qty;
    }

    public override takeBest(): TakeResult {
        // console.log(`ReserveRange.takeBest: qty=${this.qty}, width=${this.width}, right=${this.right.index()}`);
        this.assertNonEmpty();

        const qty = this.qty / this.width;
        this.qty -= qty;

        const tick = this.right.clone();
        this.right.dec();

        return { qty, tickIdx: tick };
    }

    public peekBest(): TakeResult {
        this.assertNonEmpty();

        const qty = this.qty / this.width;
        const tick = this.right.clone();

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

    public peekWorst(): TakeResult {
        this.assertNonEmpty();

        const qty = this.qty / this.width;
        const tick = this.left.clone();

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
    public setLeft(newLeft: TickIndex) {
        this.assertNonEmpty();

        if (newLeft.lt(this.left))
            panic(
                `New left ${newLeft.index()} should be bigger than old left ${this.left.index()}`
            );

        if (newLeft.gt(this.right))
            panic(
                `New left ${newLeft.index()} should be smaller than right ${this.right.index()}`
            );

        this.left = newLeft.clone();
    }

    public getLeft(): TickIndex {
        this.assertNonEmpty();
        return this.left.clone();
    }
}

/**
 * Geometrically weighted range used for inventory (right of price). The left
 * boundary is the lowest price tick (closest to price), while the right bound
 * is the highest. Tokens nearer to price get smaller allocations so the overall
 * value stays constant as the range widens.
 */
export class InventoryRange extends Range {
    constructor(qty: number, left: TickIndex, right: TickIndex) {
        if (left.gt(right))
            panic(
                `The range has invalid bounds [${left.index()}, ${right.index()}]`
            );

        super(qty, left, right);
    }

    public override unpack(curTick: TickIndex, tickSpan: number): TakeResult[] {
        const result: TakeResult[] = [];

        if (!this.isEmpty()) {
            let qty = this.bestTickQty();
            let sum = qty;

            for (const i = this.left.clone(); i.le(this.right); i.inc()) {
                if (i.distance(curTick) > tickSpan) break;

                result.push({ qty, tickIdx: i.clone() });

                qty *= BASE_PRICE;
                sum += qty;
            }
        }

        return result;
    }

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

    public bestTickIdx(): TickIndex {
        this.assertNonEmpty();

        return this.left.clone();
    }

    public peekBest(): TakeResult {
        this.assertNonEmpty();

        let qty: number;
        if (this.width === 1) {
            qty = this.qty;
        } else {
            qty = this.bestTickQty();
        }

        const tick = this.left.clone();
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

    public peekWorst(): TakeResult {
        this.assertNonEmpty();

        const qty = this.worstTickQty();
        const tick = this.right.clone();

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
