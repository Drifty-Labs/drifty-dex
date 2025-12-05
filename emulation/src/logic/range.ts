import {
    absoluteTickToPrice,
    almostEq,
    BASE_PRICE,
    panic,
    QUOTE_PRICE,
    type Side,
} from "./utils.ts";

/**
 * The result of taking a tick from a range.
 */
export type TakeResult = {
    /** The quantity of liquidity taken. */
    qty: number;
    /** The index of the tick taken. */
    tickIdx: number;
};

export abstract class Range {
    constructor(
        protected _qty: number,
        protected _left: number,
        protected _right: number,
        protected _side: Side
    ) {}

    public abstract takeBest(): TakeResult;
    public abstract takeWorst(): TakeResult;

    public abstract peekBest(): TakeResult;
    public abstract peekWorst(): TakeResult;

    public get left() {
        return this._left;
    }

    public get right() {
        return this._right;
    }

    get width() {
        return this._right - this.left + 1;
    }

    public get qty() {
        this.assertBoundsOk();

        return this._qty;
    }

    public isEmpty() {
        const empty = this.width <= 0;
        if (empty && !almostEq(this._qty, 0))
            panic(
                `The range is empty, but there is still ${this._qty} liquidity`
            );

        return empty;
    }

    protected isBase() {
        this.assertBoundsOk();

        return this._side === "base";
    }

    protected assertBoundsOk() {
        if (this.right < this.left)
            panic(`Invalid bounds [${this.left}, ${this.right}]`);
    }

    protected assertNonEmpty() {
        if (this.isEmpty())
            panic(
                "An empty range should be disposed and re-created later again"
            );
    }
}

export class ReserveRange extends Range {
    public clone(noLogs: boolean) {
        this.assertBoundsOk();

        return new ReserveRange(
            this._qty,
            this._left,
            this._right,
            this._side,
            noLogs,
            this.isDrifting
        );
    }

    constructor(
        qty: number,
        left: number,
        right: number,
        side: Side,
        private noLogs: boolean,
        private isDrifting: boolean
    ) {
        super(qty, left, right, side);

        this.assertBoundsOk();
    }

    public put(qty: number) {
        this.assertNonEmpty();
        this.assertBoundsOk();

        this._qty += qty;
    }

    public withdrawCut(cut: number): number {
        this.assertNonEmpty();
        this.assertBoundsOk();

        const qty = this._qty * cut;
        this._qty -= qty;

        return qty;
    }

    public putBest(qty: number) {
        this.assertNonEmpty();
        this.assertBoundsOk();

        this._qty += qty;

        if (this.isBase()) {
            this._left -= 1;
        } else {
            this._right += 1;
        }
    }

    public override takeBest(): TakeResult {
        this.assertNonEmpty();
        this.assertBoundsOk();

        const qty = this._qty / this.width;
        this._qty -= qty;

        const tick = this.isBase() ? this.left : this.right;
        if (this.isBase()) {
            this._left += 1;
        } else {
            this._right -= 1;
        }

        return { qty, tickIdx: tick };
    }

    public override peekBest(): TakeResult {
        this.assertNonEmpty();
        this.assertBoundsOk();

        const qty = this._qty / this.width;
        const tick = this.isBase() ? this.left : this.right;

        return { qty, tickIdx: tick };
    }

    public override takeWorst(): TakeResult {
        this.assertNonEmpty();
        this.assertBoundsOk();

        const qty = this._qty / this.width;
        this._qty -= qty;

        const tick = this.isBase() ? this.right : this.left;
        if (this.isBase()) {
            this._right -= 1;
        } else {
            this._left += 1;
        }

        return { qty, tickIdx: tick };
    }

    public override peekWorst(): TakeResult {
        this.assertNonEmpty();
        this.assertBoundsOk();

        const qty = this._qty / this.width;
        const tick = this.isBase() ? this.right : this.left;

        return { qty, tickIdx: tick };
    }

    public setWorst(newWorst: number) {
        this.assertNonEmpty();
        this.assertBoundsOk();

        if (this.isBase()) {
            this._right = newWorst;
        } else {
            this._left = newWorst;
        }

        this.assertBoundsOk();
    }
}

export class InventoryRange extends Range {
    constructor(
        qty: number,
        left: number,
        right: number,
        side: Side,
        private noLogs: boolean,
        private isDrifting: boolean
    ) {
        super(qty, left, right, side);
        this.assertBoundsOk();
    }

    public clone(noLogs: boolean) {
        this.assertBoundsOk();

        return new InventoryRange(
            this._qty,
            this._left,
            this._right,
            this._side,
            noLogs,
            this.isDrifting
        );
    }

    public override takeBest(): TakeResult {
        this.assertNonEmpty();
        this.assertBoundsOk();

        const qty = this.bestTickQty();
        this._qty -= qty;

        const tick = this.isBase() ? this.right : this.left;
        if (this.isBase()) {
            this._right -= 1;
        } else {
            this._left += 1;
        }

        if (this.isEmpty()) {
            this._qty = 0;
        }

        return { qty, tickIdx: tick };
    }

    public override peekBest(): TakeResult {
        this.assertNonEmpty();
        this.assertBoundsOk();

        const qty = this.bestTickQty();

        const tick = this.isBase() ? this.right : this.left;
        return { qty, tickIdx: tick };
    }

    public override takeWorst(): TakeResult {
        this.assertNonEmpty();
        this.assertBoundsOk();

        const qty = this.worstTickQty();
        this._qty -= qty;

        const tick = this.isBase() ? this.left : this.right;
        if (this.isBase()) {
            this._left += 1;
        } else {
            this._right -= 1;
        }

        if (this.isEmpty()) {
            this._qty = 0;
        }

        return { qty, tickIdx: tick };
    }

    public peekWorst(): TakeResult {
        this.assertNonEmpty();
        this.assertBoundsOk();

        const qty = this.worstTickQty();
        const tick = this.isBase() ? this.left : this.right;

        return { qty, tickIdx: tick };
    }

    public putBest(qty: number, curTick: number) {
        this.assertNonEmpty();
        this.assertBoundsOk();

        this._qty += qty;

        if (this.isBase()) {
            this._right += 1;
        } else {
            this._left -= 1;
        }

        const tick = this.isBase() ? this.right : this.left;

        if (tick !== curTick)
            panic(
                `Invalid inventory cur tick: expect ${curTick}, have ${tick}`
            );
    }

    public calcRespectiveReserve(): number {
        this.assertNonEmpty();
        this.assertBoundsOk();

        // reserve is always uniform for a single inventory range
        const i = this.peekBest();
        const r =
            i.qty * absoluteTickToPrice(i.tickIdx, this._side, "inventory");

        // which means we can simply multiply by width
        return r * this.width;
    }

    private bestTickQty(): number {
        this.assertBoundsOk();

        if (this.width === 1) return this.qty;

        return (
            (this.qty * (1 - QUOTE_PRICE)) /
            (1 - Math.pow(QUOTE_PRICE, this.width))
        );
    }

    private worstTickQty(): number {
        this.assertBoundsOk();

        if (this.width === 1) return this.qty;

        return this.bestTickQty() * Math.pow(QUOTE_PRICE, this.width - 1);
    }
}
