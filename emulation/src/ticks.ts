import { MAX_TICK, MIN_TICK, panic, TwoSided, twoSided } from "./utils.ts";

export class Tick {
    public onDemand = defaultInstruction();
    public onTimer = defaultInstruction();

    public addBefore(side: keyof TwoSided<number>) {
        return this.onDemand.addBefore[side] + this.onTimer.addBefore[side];
    }

    public removeAfter(side: keyof TwoSided<number>) {
        return this.onDemand.removeAfter[side] + this.onTimer.removeAfter[side];
    }
}

type ReturnedTick = { allocated: boolean; tick: Tick };

export class PricePlane {
    private ticks: Partial<Record<number, Tick>> = {};

    public incrementTick(): ReturnedTick {
        if (this.curTick === MAX_TICK) panic("Max price reached");
        this.curTick += 1;

        return this.getOrCreateCurTick();
    }

    public decrementTick(): ReturnedTick {
        if (this.curTick === MIN_TICK) panic("Min price reached");
        this.curTick -= 1;

        return this.getOrCreateCurTick();
    }

    public getOrCreateCurTick(): ReturnedTick {
        let tick = this.ticks[this.curTick];

        // the next tick is not allocated yet
        if (!tick) {
            tick = new Tick();
            this.ticks[this.curTick] = tick;

            return { allocated: false, tick };
        }

        return { allocated: true, tick };
    }

    constructor(private curTick: number) {}
}

export type TickInstruction = {
    addBefore: TwoSided<number>;
    removeAfter: TwoSided<number>;
};

function defaultInstruction(): TickInstruction {
    return {
        addBefore: twoSided(0, 0),
        removeAfter: twoSided(0, 0),
    };
}
