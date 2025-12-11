import { Beacon } from "./beacon.ts";
import { ECs } from "./ecs.ts";
import { Pool } from "./pool.ts";
import { Range, type TakeResult } from "./range.ts";
import {
    type AMMSwapDirection,
    MAX_TICK,
    MIN_TICK,
    panic,
    type TwoAmmSided,
} from "./utils.ts";

export class Liquidity {
    public takeNextTick(
        direction: AMMSwapDirection,
        fromCurTick: TakeResult,
        curTickIdx: number
    ): TakeResult {
        if (direction === "reserve -> inventory") {
            if (this.reserve) {
                this.reserve.putBestUniform(fromCurTick.reserveQty);
            } else {
                this.deposit(fromCurTick.reserveQty, fromCurTick.tickIdx);
            }

            const best = this.takeBestInventoryTick(curTickIdx);
            if (best) return best;
        } else {
            this.putBestInventoryTick(fromCurTick);

            const best = this._reserve?.takeBest();
            if (best && this._reserve?.isEmptyNonChecking()) {
                this._reserve = undefined;
            }

            if (best) return best;
        }

        return {
            tickIdx: curTickIdx,
            reserveQty: ECs.zero(),
            respectiveInventoryQty: ECs.zero(),
        };
    }

    public borrowInventoryForRecovery(
        fn: (tick: TakeResult) =>
            | {
                  leftoverReserveQty: ECs;
                  curTickIdx: number;
              }
            | undefined
    ) {
        while (true) {
            const tickBefore = this.takeWorstInventoryTick();
            if (!tickBefore) {
                break;
            }

            const res = fn({
                reserveQty: tickBefore.reserveQty.clone(),
                respectiveInventoryQty:
                    tickBefore.respectiveInventoryQty.clone(),
                tickIdx: tickBefore.tickIdx,
            });

            if (!res) {
                this.putWorstInventoryTick(tickBefore);

                break;
            }

            const { leftoverReserveQty, curTickIdx } = res;

            const recoveredReserveQty =
                tickBefore.reserveQty.sub(leftoverReserveQty);

            if (recoveredReserveQty.isPositive()) {
                this.deposit(recoveredReserveQty.clone(), curTickIdx);
            }

            if (leftoverReserveQty.isPositive()) {
                const tickAfter: TakeResult = {
                    reserveQty: leftoverReserveQty,
                    respectiveInventoryQty: leftoverReserveQty.mul(
                        this.$.price(tickBefore.tickIdx)
                    ),
                    tickIdx: tickBefore.tickIdx,
                };

                this.putWorstInventoryTick(tickAfter);

                break;
            }
        }
    }

    public driftReserveWorst(newWorst: number) {
        if (!this.reserve) return;

        const tickSpan = this._getTickSpan ? this._getTickSpan() : undefined;
        if (!tickSpan) return;

        try {
            const cp = this.reserve.clone(this.$.pool, !this.$.isLogging);
            cp.driftReserveWorst(newWorst);

            if (cp.getWidth() < tickSpan) return;
            this._reserve = cp;
        } catch {
            /* noop */
        }
    }

    public deposit(reserveQty: ECs, curTickIdx: number) {
        if (this._reserve) {
            this._reserve.putUniform(reserveQty);
        } else {
            const left = this.$.isBase
                ? curTickIdx + 1
                : this._getTickSpan
                ? curTickIdx - 1 - this._getTickSpan()
                : MIN_TICK;

            const right = this.$.isBase
                ? this._getTickSpan
                    ? curTickIdx + this._getTickSpan() + 1
                    : MAX_TICK
                : curTickIdx - 1;

            this._reserve = new Range(
                reserveQty.clone(),
                left,
                right,
                this.$.clone({ ammSide: "reserve" })
            );
        }
    }

    public withdraw(cut: ECs): TwoAmmSided<ECs> {
        const reserve = ECs.zero();
        const inventory = ECs.zero();

        if (this._reserve) {
            reserve.addAssign(this._reserve.splitUniform(cut).getReserveQty());
        }

        for (const inv of this._inventory) {
            inventory.addAssign(
                inv.splitUniform(cut).getRespectiveInventoryQty()
            );
        }

        return { reserve, inventory };
    }

    public getInventoryWidth() {
        if (this._inventory.length === 0) return 0;

        const left = this._inventory[0].getLeft();
        const right = this._inventory[this._inventory.length - 1].getRight();

        return right - left + 1;
    }

    constructor(
        private _reserve: Range | undefined,
        private _inventory: Range[],
        private _getTickSpan: (() => number) | undefined,
        private $: Beacon
    ) {}

    public clone(
        pool: Pool,
        noLogs: boolean,
        _getTickSpan: (() => number) | undefined
    ) {
        return new Liquidity(
            this._reserve?.clone(pool, noLogs),
            this._inventory.map((it) => it.clone(pool, noLogs)),
            _getTickSpan,
            this.$.clone({ noLogs, pool })
        );
    }

    public get reserve() {
        return this._reserve;
    }

    public get inventory() {
        return this._inventory;
    }

    private takeBestInventoryTick(curTickIdx: number): TakeResult | undefined {
        if (this._inventory.length === 0) return undefined;

        const range = this.takeBestInventoryRange();
        if (!range) return undefined;

        if (range.getBest() !== curTickIdx) {
            this.putBestInventoryRange(range);
            return undefined;
        }

        const tick = range.takeBest();
        if (!range.isEmptyNonChecking()) this.putBestInventoryRange(range);

        return tick;
    }

    private putBestInventoryTick(tick: TakeResult) {
        if (tick.reserveQty.isZero()) return;

        let range: Range;

        if (this._inventory.length === 0) {
            range = new Range(
                tick.reserveQty,
                tick.tickIdx,
                tick.tickIdx,
                this.$.clone({ ammSide: "inventory" })
            );
        } else {
            range = this.takeBestInventoryRange() ?? panic();

            if (range.getPerTickReserveQty().eq(tick.reserveQty)) {
                range.putBest(tick.reserveQty);
            } else {
                this.putBestInventoryRange(range);

                range = new Range(
                    tick.reserveQty,
                    tick.tickIdx,
                    tick.tickIdx,
                    this.$.clone({ ammSide: "inventory" })
                );
            }
        }

        this.putBestInventoryRange(range);
    }

    private takeWorstInventoryTick(): TakeResult | undefined {
        if (this._inventory.length === 0) return undefined;

        const range = this.takeWorstInventoryRange();
        if (!range) return undefined;

        const tick = range.takeWorst();
        if (!range.isEmptyNonChecking()) this.putWorstInventoryRange(range);

        return tick;
    }

    private putWorstInventoryTick(tick: TakeResult) {
        if (tick.reserveQty.isZero()) return;

        let range: Range;

        if (this._inventory.length === 0) {
            range = new Range(
                tick.reserveQty,
                tick.tickIdx,
                tick.tickIdx,
                this.$.clone({ ammSide: "inventory" })
            );
        } else {
            range = this.takeWorstInventoryRange() ?? panic();

            if (range.getPerTickReserveQty().eq(tick.reserveQty)) {
                range.putWorst(tick.reserveQty);
            } else {
                this.putWorstInventoryRange(range);
                range = new Range(
                    tick.reserveQty,
                    tick.tickIdx,
                    tick.tickIdx,
                    this.$.clone({ ammSide: "inventory" })
                );
            }
        }

        this.putWorstInventoryRange(range);
    }

    private takeBestInventoryRange(): Range | undefined {
        if (this._inventory.length === 0) return undefined;

        if (this.$.isBase) return this._inventory.pop();
        else return this._inventory.shift();
    }

    private putBestInventoryRange(range: Range) {
        if (range.isEmpty())
            panic(`[Liquidity ${this.$}] Unable to put empty range`);

        if (this.$.isBase) this._inventory.push(range);
        else this._inventory.unshift(range);
    }

    private takeWorstInventoryRange(): Range | undefined {
        if (this._inventory.length === 0) return undefined;

        if (this.$.isBase) return this._inventory.shift();
        else return this._inventory.pop();
    }

    private putWorstInventoryRange(range: Range) {
        if (range.isEmpty())
            panic(`[Liquidity ${this.$}] Unable to put empty range`);

        if (this.$.isBase) this._inventory.unshift(range);
        else this._inventory.push(range);
    }

    public getBestInventory() {
        if (this._inventory.length === 0) return undefined;

        if (this.$.isBase)
            return this._inventory[this.inventory.length - 1].getBest();
        else return this._inventory[0].getBest();
    }

    public getWorstInventory() {
        if (this._inventory.length === 0) return undefined;

        if (this.$.isBase) return this._inventory[0].getWorst();
        else return this._inventory[this._inventory.length - 1].getWorst();
    }

    public peekWorstInventory() {
        if (this._inventory.length === 0) return undefined;

        if (this.$.isBase) return this._inventory[0].peekWorst();
        else return this._inventory[this._inventory.length - 1].peekWorst();
    }
}
