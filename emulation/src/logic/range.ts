import { Beacon } from "./beacon.ts";
import { BASE_PRICE, ECs } from "./ecs.ts";
import { panic } from "./utils.ts";

/**
 * The result of taking a tick from a range.
 */
export type TakeResult = {
    reserveQty: ECs;
    respectiveInventoryQty: ECs;
    tickIdx: number;
};

export class Range {
    public putBest(reserveQty: ECs) {
        this.assertNonEmpty();
        this.assertBoundsOk();

        if (reserveQty.isPositive()) {
            if (!reserveQty.almostEq(this.getPerTickReserveQty()))
                panic(
                    `[Range ${
                        this.$
                    }] The range has to stay uniform: perTick=${this.getPerTickReserveQty()}, putting=${reserveQty}`
                );
        }
        this._reserveQty.addAssign(this.getPerTickReserveQty());

        if (this.$.isBase) {
            if (this.$.isReserve) this._left -= 1;
            else this._right += 1;
        } else {
            if (this.$.isReserve) this._right += 1;
            else this._left -= 1;
        }
    }

    public putBestUniform(reserveQty: ECs) {
        this.assertNonEmpty();
        this.assertBoundsOk();

        this._reserveQty.addAssign(reserveQty);

        if (this.$.isBase) {
            if (this.$.isReserve) this._left -= 1;
            else this._right += 1;
        } else {
            if (this.$.isReserve) this._right += 1;
            else this._left -= 1;
        }
    }

    public putWorst(reserveQty: ECs) {
        this.assertNonEmpty();
        this.assertBoundsOk();

        if (reserveQty.isPositive()) {
            if (!reserveQty.almostEq(this.getPerTickReserveQty()))
                panic(
                    `[Range ${
                        this.$
                    }] The range has to stay uniform: perTick=${this.getPerTickReserveQty()}, putting=${reserveQty}`
                );
        }

        this._reserveQty.addAssign(this.getPerTickReserveQty());

        if (this.$.isBase) {
            if (this.$.isReserve) this._right += 1;
            else this._left -= 1;
        } else {
            if (this.$.isReserve) this._left -= 1;
            else this._right += 1;
        }
    }

    public takeBest(): TakeResult {
        this.assertNonEmpty();
        this.assertBoundsOk();

        const reserveQty = this.getPerTickReserveQty();
        this._reserveQty.subAssign(reserveQty);

        let tickIdx;
        if (this.$.isBase) {
            if (this.$.isReserve) {
                tickIdx = this._left;
                this._left += 1;
            } else {
                tickIdx = this._right;
                this._right -= 1;
            }
        } else {
            if (this.$.isReserve) {
                tickIdx = this._right;
                this._right -= 1;
            } else {
                tickIdx = this._left;
                this._left += 1;
            }
        }

        const respectiveInventoryQty = reserveQty.mul(this.$.price(tickIdx));

        return { reserveQty, respectiveInventoryQty, tickIdx };
    }

    public takeWorst(): TakeResult {
        this.assertNonEmpty();
        this.assertBoundsOk();

        const reserveQty = this.getPerTickReserveQty();
        this._reserveQty.subAssign(reserveQty);

        let tickIdx;
        if (this.$.isBase) {
            if (this.$.isReserve) {
                tickIdx = this._right;
                this._right -= 1;
            } else {
                tickIdx = this._left;
                this._left += 1;
            }
        } else {
            if (this.$.isReserve) {
                tickIdx = this._left;
                this._left += 1;
            } else {
                tickIdx = this._right;
                this._right -= 1;
            }
        }

        const respectiveInventoryQty = reserveQty.mul(this.$.price(tickIdx));

        return {
            reserveQty,
            respectiveInventoryQty,
            tickIdx,
        };
    }

    public peekBest(): TakeResult {
        this.assertNonEmpty();
        this.assertBoundsOk();

        const reserveQty = this.getPerTickReserveQty();
        const tickIdx = this.getBest();
        const respectiveInventoryQty = reserveQty.mul(this.$.price(tickIdx));

        return { reserveQty, respectiveInventoryQty, tickIdx };
    }

    public peekWorst(): TakeResult {
        this.assertNonEmpty();
        this.assertBoundsOk();

        const reserveQty = this.getPerTickReserveQty();
        const tickIdx = this.getWorst();
        const respectiveInventoryQty = reserveQty.mul(this.$.price(tickIdx));

        return { reserveQty, respectiveInventoryQty, tickIdx };
    }

    public putUniform(reserveQty: ECs) {
        this.assertNonEmpty();
        this.assertBoundsOk();

        this._reserveQty.addAssign(reserveQty);
    }

    public splitUniform(cut: ECs): Range {
        this.assertNonEmpty();
        this.assertBoundsOk();

        const qty = this._reserveQty.mul(cut);
        this._reserveQty.subAssign(qty);

        return new Range(
            qty,
            this.getLeft(),
            this.getRight(),
            this.$.clone(undefined)
        );
    }

    public driftReserveWorst(newWorst: number) {
        this.assertNonEmpty();
        this.assertBoundsOk();

        if (!this.$.isReserve)
            panic(
                `[Range ${this.$}] The range is not inventory, so it can't drift`
            );

        if (this.$.isBase) {
            this._right = newWorst;
        } else {
            this._left = newWorst;
        }

        this.assertBoundsOk();
    }

    constructor(
        private _reserveQty: ECs,
        private _left: number,
        private _right: number,
        private $: Beacon
    ) {}

    public clone(noLogs: boolean) {
        return new Range(
            this.getReserveQty(),
            this.getLeft(),
            this.getRight(),
            this.$.clone({ noLogs })
        );
    }

    public static reserve(args: {
        qty: ECs;
        left: number;
        right: number;
        $: Beacon;
    }) {
        return new Range(
            args.qty,
            args.left,
            args.right,
            args.$.clone(undefined)
        );
    }

    public static inventory(args: {
        qty: ECs;
        left: number;
        right: number;
        $: Beacon;
    }) {
        return new Range(
            args.qty,
            args.left,
            args.right,
            args.$.clone(undefined)
        );
    }

    public includesTickIdx(tickIdx: number) {
        this.assertBoundsOk();

        return tickIdx >= this._left && tickIdx <= this._right;
    }

    public getLeft() {
        return this._left;
    }

    public getRight() {
        return this._right;
    }

    public getWidth() {
        this.assertBoundsOk();

        return this._right - this._left + 1;
    }

    public getPerTickReserveQty() {
        return this.getReserveQty().div(this.getWidth());
    }

    public getReserveQty() {
        this.assertBoundsOk();

        return this._reserveQty.clone();
    }

    public calcInventoryQtyAtTick(tickIdx: number) {
        return this.getPerTickReserveQty().mul(this.$.price(tickIdx));
    }

    public calcInventoryQty() {
        this.assertBoundsOk();

        const worstTickQty = this.calcInventoryQtyAtTick(this.getWorst());
        if (this.getWidth() === 1) return worstTickQty;

        return worstTickQty
            .mul(BASE_PRICE.pow(this.getWidth()).sub(ECs.one()))
            .div(BASE_PRICE.sub(ECs.one()));
    }

    public getWorst() {
        if (this.$.isBase) {
            return this.$.isReserve ? this.getRight() : this.getLeft();
        } else {
            return this.$.isReserve ? this.getLeft() : this.getRight();
        }
    }

    public getBest() {
        if (this.$.isBase) {
            return this.$.isReserve ? this.getLeft() : this.getRight();
        } else {
            return this.$.isReserve ? this.getRight() : this.getLeft();
        }
    }

    public isEmpty() {
        const empty = this.getWidth() <= 0;
        if (empty && !this._reserveQty.isZero())
            panic(
                `[Range ${this.$}] The range is empty, but there is still ${this._reserveQty} liquidity`
            );

        return empty;
    }

    public isEmptyNonChecking() {
        return this._reserveQty.isZero();
    }

    protected assertBoundsOk() {
        if (this.getRight < this.getLeft)
            panic(
                `[Range ${
                    this.$
                }] Invalid bounds [${this.getLeft()}, ${this.getRight()}]`
            );
    }

    protected assertNonEmpty() {
        if (this.isEmpty())
            panic(
                `[Range ${this.$}] An empty range should be disposed and re-created later again`
            );
    }
}
