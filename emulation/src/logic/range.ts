import { E8s } from "./ecs.ts";
import { absoluteTickToPrice, panic, QUOTE_PRICE, type Side } from "./utils.ts";

/**
 * The result of taking a tick from a range.
 */
export type TakeResult = {
    /** The quantity of liquidity taken. */
    qty: E8s;
    /** The index of the tick taken. */
    tickIdx: number;
};

export abstract class Range {
    constructor(
        protected _qty: E8s,
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

        return this._qty.clone();
    }

    public isEmpty() {
        const empty = this.width <= 0;
        if (empty && !this._qty.isZero())
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
            this._qty.clone(),
            this._left,
            this._right,
            this._side,
            noLogs,
            this.isDrifting
        );
    }

    constructor(
        qty: E8s,
        left: number,
        right: number,
        side: Side,
        private noLogs: boolean,
        private isDrifting: boolean
    ) {
        super(qty.clone(), left, right, side);

        this.assertBoundsOk();
    }

    public put(qty: E8s) {
        this.assertNonEmpty();
        this.assertBoundsOk();

        this.qty.addAssign(qty);
    }

    public withdrawCut(cut: E8s): E8s {
        this.assertNonEmpty();
        this.assertBoundsOk();

        const qty = this._qty.mul(cut);
        this._qty.subAssign(qty);

        return qty;
    }

    public putBest(qty: E8s) {
        this.assertNonEmpty();
        this.assertBoundsOk();

        this._qty.addAssign(qty);

        if (this.isBase()) {
            this._left -= 1;
        } else {
            this._right += 1;
        }
    }

    public override takeBest(): TakeResult {
        this.assertNonEmpty();
        this.assertBoundsOk();

        const qty = this._qty.div(this.width);
        this._qty.subAssign(qty);

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

        const qty = this._qty.div(this.width);
        const tick = this.isBase() ? this.left : this.right;

        return { qty, tickIdx: tick };
    }

    public override takeWorst(): TakeResult {
        this.assertNonEmpty();
        this.assertBoundsOk();

        const qty = this._qty.div(this.width);
        this._qty.subAssign(qty);

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

        const qty = this._qty.div(this.width);
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
        qty: E8s,
        left: number,
        right: number,
        side: Side,
        private noLogs: boolean,
        private isDrifting: boolean
    ) {
        super(qty.clone(), left, right, side);
        this.assertBoundsOk();
    }

    public clone(noLogs: boolean) {
        this.assertBoundsOk();

        return new InventoryRange(
            this._qty.clone(),
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
        this._qty.subAssign(qty);

        const tick = this.isBase() ? this.right : this.left;
        if (this.isBase()) {
            this._right -= 1;
        } else {
            this._left += 1;
        }

        if (this.isEmpty()) {
            this._qty = E8s.zero();
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
        this._qty.subAssign(qty);

        const tick = this.isBase() ? this.left : this.right;
        if (this.isBase()) {
            this._left += 1;
        } else {
            this._right -= 1;
        }

        if (this.isEmpty()) {
            this._qty = E8s.zero();
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

    public putBest(qty: E8s, curTick: number) {
        this.assertNonEmpty();
        this.assertBoundsOk();

        this._qty.addAssign(qty);

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

    public calcRespectiveReserve(): E8s {
        this.assertNonEmpty();
        this.assertBoundsOk();

        // reserve is always uniform for a single inventory range
        const i = this.peekBest();
        const r = i.qty.mul(
            absoluteTickToPrice(i.tickIdx, this._side, "inventory")
        );

        // which means we can simply multiply by width
        return r.mul(this.width);
    }

    private bestTickQty(): E8s {
        this.assertBoundsOk();

        if (this.width === 1) return this.qty.clone();

        return this.qty
            .mul(E8s.one().sub(QUOTE_PRICE))
            .div(E8s.one().sub(QUOTE_PRICE.pow(this.width)));
    }

    private worstTickQty(): E8s {
        this.assertBoundsOk();

        if (this.width === 1) return this.qty.clone();

        return this.bestTickQty().mul(QUOTE_PRICE.pow(this.width - 1));
    }
}
