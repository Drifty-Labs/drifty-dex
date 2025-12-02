import type { ReserveTick } from "./liquidity.ts";
import { TickIndex } from "./ticks.ts";
import { almostEq, panic, tickToPrice } from "./utils.ts";

/**
 * The result of taking a tick from a range.
 */
export type TakeResult = {
    /** The quantity of liquidity taken. */
    qty: number;
    /** The index of the tick taken. */
    tickIdx: TickIndex;
};

export abstract class Range {
    constructor(
        protected qty: number,
        protected left: TickIndex,
        protected right: TickIndex
    ) {}

    public abstract takeBest(): TakeResult;
    public abstract takeWorst(): TakeResult;

    get width() {
        if (this.right.lt(this.left)) return 0;

        return this.right.distance(this.left) + 1;
    }

    public getQty() {
        return this.qty;
    }

    public isEmpty() {
        const empty = this.width <= 0;
        if (empty && !almostEq(this.qty, 0))
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
    public clone() {
        return new ReserveRange(
            this.qty,
            this.left.clone(),
            this.right.clone()
        );
    }

    constructor(qty: number, left: TickIndex, right: TickIndex) {
        if (left.gt(right))
            panic(
                `The range has invalid bounds [${left.index()}, ${right.index()}]`
            );

        super(qty, left, right);
    }

    public put(qty: number) {
        this.assertNonEmpty();
        this.qty += qty;
    }

    public putBest(qty: number): TickIndex {
        this.assertNonEmpty();

        this.qty += qty;
        this.right.inc();

        return this.right.clone();
    }

    public withdrawCut(cut: number): number {
        this.assertNonEmpty();

        const qty = this.qty * cut;
        this.qty -= qty;

        return qty;
    }

    public override takeBest(): TakeResult {
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

export class InventoryRange extends Range {
    constructor(qty: number, left: TickIndex, right: TickIndex) {
        if (left.gt(right))
            panic(
                `The range has invalid bounds [${left.index()}, ${right.index()}]`
            );

        super(qty, left, right);
    }

    public clone() {
        return new InventoryRange(
            this.qty,
            this.left.clone(),
            this.right.clone()
        );
    }

    // TODO: do with a formula
    public calcRespectiveReserve(): number {
        this.assertNonEmpty();

        let qty = this.bestTickQty();
        const ratio = this.perTickPriceRatio();
        let sum = 0;

        for (const i = this.left.clone(); i.le(this.right); i.inc()) {
            const respectiveValue = qty * tickToPrice(i, "inventory");
            sum += respectiveValue;
            qty *= ratio;

            if (i.eq(this.right)) break;
        }

        return sum;
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

    private perTickPriceRatio(): number {
        if (this.width <= 1) return 1;

        // Total price ratio from best (left) to worst (right)
        const totalPriceRatio = this.right.price / this.left.price;
        // Per-tick ratio is the (width-1)th root of total ratio
        return Math.pow(totalPriceRatio, 1 / (this.width - 1));
    }

    private bestTickQty(): number {
        const r = this.perTickPriceRatio();
        if (almostEq(r, 1)) return this.qty;

        return (this.qty * (r - 1)) / (Math.pow(r, this.width) - 1);
    }

    private worstTickQty(): number {
        const r = this.perTickPriceRatio();
        return this.bestTickQty() * Math.pow(r, this.width - 1);
    }
}
