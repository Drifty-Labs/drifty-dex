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
        if (this.right < this.left)
            panic(`Invalid bounds [${this.left}, ${this.right}]`);

        return this._right - this.left + 1;
    }

    public get qty() {
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
        return this._side === "base";
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
        return new ReserveRange(this._qty, this._left, this._right, this._side);
    }

    constructor(qty: number, left: number, right: number, side: Side) {
        if (left > right)
            panic(`The range has invalid bounds [${left}, ${right}]`);

        super(qty, left, right, side);
    }

    public put(qty: number) {
        this.assertNonEmpty();
        this._qty += qty;
    }

    public withdrawCut(cut: number): number {
        this.assertNonEmpty();

        const qty = this._qty * cut;
        this._qty -= qty;

        return qty;
    }

    public putBest(qty: number) {
        this.assertNonEmpty();

        this._qty += qty;

        if (this.isBase()) {
            this._left -= 1;
        } else {
            this._right += 1;
        }
    }

    public override takeBest(): TakeResult {
        this.assertNonEmpty();

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

        const qty = this._qty / this.width;
        const tick = this.isBase() ? this.left : this.right;

        return { qty, tickIdx: tick };
    }

    public override takeWorst(): TakeResult {
        this.assertNonEmpty();

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

        const qty = this._qty / this.width;
        const tick = this.isBase() ? this.right : this.left;

        return { qty, tickIdx: tick };
    }

    public setWorst(newWorst: number) {
        this.assertNonEmpty();

        if (newWorst < this.left || newWorst > this.right)
            panic(
                `New worst tick outside bounds ${newWorst} !C [${this.left}, ${this.right}]`
            );

        if (this.isBase()) {
            this._right = newWorst;
        } else {
            this._left = newWorst;
        }
    }
}

export class InventoryRange extends Range {
    constructor(qty: number, left: number, right: number, side: Side) {
        if (left > right)
            panic(`The range has invalid bounds [${left}, ${right}]`);

        super(qty, left, right, side);
    }

    public clone() {
        return new InventoryRange(
            this._qty,
            this._left,
            this._right,
            this._side
        );
    }

    public calcRespectiveReserve(): number {
        this.assertNonEmpty();

        let qty = this.bestTickQty();
        let sum = 0;

        for (let i = this._left; i <= this.right; i++) {
            const respectiveValue =
                qty * absoluteTickToPrice(i, this._side, "inventory");
            sum += respectiveValue;
            qty *= BASE_PRICE;
        }

        return sum;
    }

    public override takeBest(): TakeResult {
        this.assertNonEmpty();

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

        let qty: number;
        if (this.width === 1) {
            qty = this._qty;
        } else {
            qty = this.bestTickQty();
        }

        const tick = this.isBase() ? this.right : this.left;
        return { qty, tickIdx: tick };
    }

    public override takeWorst(): TakeResult {
        this.assertNonEmpty();

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

        const qty = this.worstTickQty();
        const tick = this.isBase() ? this.left : this.right;

        return { qty, tickIdx: tick };
    }

    public putBest(qty: number, curTick: number) {
        this.assertNonEmpty();

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

    private bestTickQty(): number {
        return this.isBase()
            ? (this.qty * (1 - QUOTE_PRICE)) /
                  (1 - Math.pow(QUOTE_PRICE, this.width))
            : (this.qty * (BASE_PRICE - 1)) /
                  (Math.pow(BASE_PRICE, this.width) - 1);
    }

    private worstTickQty(): number {
        return (
            this.bestTickQty() *
            (this.isBase()
                ? Math.pow(QUOTE_PRICE, this.width)
                : Math.pow(BASE_PRICE, this.width))
        );
    }
}
