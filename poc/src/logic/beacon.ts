import { absoluteTickToPrice } from "./ecs.ts";
import { Pool } from "./pool.ts";
import {
    type AMMSide,
    type DriftingStatus,
    panic,
    type Side,
} from "./utils.ts";

export class Beacon {
    protected _side: Side;
    protected _ammSide: AMMSide | undefined;
    protected _driftingStatus: DriftingStatus;
    protected _noLogs: boolean;
    protected _pool: Pool;

    public static base(
        pool: Pool,
        driftingStatus: DriftingStatus = "stable",
        ammSide: AMMSide | undefined = undefined,
        noLogs: boolean = false
    ) {
        return new Beacon(pool, "base", ammSide, driftingStatus, noLogs);
    }

    public static quote(
        pool: Pool,
        driftingStatus: DriftingStatus = "stable",
        ammSide: AMMSide | undefined = undefined,
        noLogs: boolean = false
    ) {
        return new Beacon(pool, "quote", ammSide, driftingStatus, noLogs);
    }

    constructor(
        pool: Pool,
        side: Side,
        ammSide: AMMSide | undefined,
        driftingStatus: DriftingStatus,
        noLogs?: boolean
    ) {
        this._pool = pool;
        this._side = side;
        this._ammSide = ammSide;
        this._driftingStatus = driftingStatus;
        this._noLogs = noLogs ?? false;
    }

    public clone(args?: {
        pool?: Pool;
        side?: Side;
        ammSide?: AMMSide;
        driftingStatus?: DriftingStatus;
        noLogs?: boolean;
    }) {
        return new Beacon(
            args?.pool ?? this.pool,
            args?.side ?? this._side,
            args?.ammSide ?? this._ammSide,
            args?.driftingStatus ?? this._driftingStatus,
            args?.noLogs ?? this._noLogs
        );
    }

    public toString() {
        return `${this._ammSide === undefined ? "" : this._ammSide + " "}${
            this._side
        } ${this._driftingStatus}${this._noLogs ? " noLogs" : ""}`;
    }

    public price(tickIdx: number, lhs: AMMSide = "reserve") {
        return absoluteTickToPrice(tickIdx, this._side, lhs);
    }

    public get isBase() {
        return this._side === "base";
    }

    public get isDrifting() {
        return this._driftingStatus === "drifting";
    }

    public get isReserve() {
        if (this._ammSide === undefined)
            panic(
                `[Beacon ${this}] The beacon is not amm-oriented, can't check if reserve or not`
            );

        return this._ammSide === "reserve";
    }

    public get isLogging() {
        return !this._noLogs;
    }

    public get pool() {
        return this._pool;
    }
}
