import { Beacon } from "./beacon.ts";
import { CurrentTick } from "./cur-tick.ts";
import { ECs } from "./ecs.ts";
import { Liquidity } from "./liquidity.ts";
import { Pool } from "./pool.ts";
import { type TakeResult, Range } from "./range.ts";
import { type TwoAmmSided } from "./utils.ts";

/**
 * Arguments for depositing liquidity into an AMM.
 */
export type DepositArgs = {
    /** The amount of reserve to deposit. */
    reserve: ECs;
};

/**
 * Arguments for withdrawing liquidity from an AMM.
 */
export type WithdrawArgs = {
    /**
     * The amount of deposited reserve to withdraw.
     * Should be the same as was really deposited.
     */
    depositedReserve: ECs;
};

/**
 * Total liquidity of the AMM
 */
export type LiquidityDigest = {
    curTick: {
        idx: number;
        reserve: ECs;
        inventory: ECs;
    };
    recoveryBin: {
        collateral: ECs;
        worstTick?: TakeResult;
    };
    reserve?: Range;
    inventory: Range[];
};

export class AMM {
    private _depositedReserve = ECs.zero();

    constructor(
        private $: Beacon,
        _getTickSpan: (() => number) | undefined,
        curTickIdx: number,
        private _liquidity: Liquidity = new Liquidity(
            undefined,
            [],
            _getTickSpan,
            $.clone()
        ),
        private _currentTick: CurrentTick = new CurrentTick(
            curTickIdx,
            _liquidity,
            $.clone()
        )
    ) {}

    public clone(
        pool: Pool,
        noLogs: boolean,
        _getTickSpan: (() => number) | undefined
    ) {
        const liq = this._liquidity.clone(pool, noLogs, _getTickSpan);
        const ct = this._currentTick.clone(pool, liq, noLogs);

        const a = new AMM(
            this.$.clone({ noLogs, pool }),
            _getTickSpan,
            ct.getIndex(),
            liq,
            ct
        );

        a._depositedReserve = this._depositedReserve.clone();

        return a;
    }

    public deposit(args: DepositArgs): void {
        this._liquidity.deposit(args.reserve, this._currentTick.getIndex());
        this._depositedReserve.addAssign(args.reserve);
    }

    public withdraw(args: WithdrawArgs): TwoAmmSided<ECs> {
        const cut = args.depositedReserve.div(this._depositedReserve);
        const { reserve: r1, inventory: i1 } = this._liquidity.withdraw(cut);

        const { reserve: r2, inventory: i2 } =
            this._currentTick.withdrawCut(cut);

        this._depositedReserve.subAssign(args.depositedReserve);

        return { reserve: r1.add(r2), inventory: i1.add(i2) };
    }

    public get currentTick(): CurrentTick {
        return this._currentTick;
    }

    public get liquidity(): Liquidity {
        return this._liquidity;
    }

    public get liquidityDigest(): LiquidityDigest {
        return {
            curTick: {
                idx: this._currentTick.getIndex(),
                reserve: this._currentTick.getCurrentReserve(),
                inventory: this._currentTick.getCurrentInventory(),
            },
            recoveryBin: {
                collateral: this._currentTick.getRecoveryBin().getCollateral(),
            },
            reserve: this._liquidity.reserve?.clone(
                this.$.pool,
                !this.$.isLogging
            ),
            inventory: this._liquidity.inventory.map((it) =>
                it.clone(this.$.pool, !this.$.isLogging)
            ),
        };
    }

    public get il(): ECs {
        if (this._liquidity.inventory.length === 0) {
            return ECs.zero();
        }

        return ECs.one().sub(
            this.getExpectedReserve()
                .add(this.getActualReserve())
                .div(this.getRespectiveReserve().add(this.getActualReserve()))
        );
    }

    public getDepositedReserve(): ECs {
        return this._depositedReserve.clone();
    }

    public getActualReserve(): ECs {
        return (this._liquidity.reserve?.getReserveQty() ?? ECs.zero()).add(
            this.currentTick.getCurrentReserve()
        );
    }

    public getActualInventory(): ECs {
        const liquidityInventory = this._liquidity.inventory.reduce(
            (prev, cur) => prev.add(cur.calcInventoryQty()),
            ECs.zero()
        );

        return liquidityInventory.add(this.currentTick.getCurrentInventory());
    }

    // if all inventory sold at current price
    public getExpectedReserve(): ECs {
        return this.getActualInventory().mul(
            this.$.price(this.currentTick.getIndex(), "inventory")
        );
    }

    public getRespectiveReserve(): ECs {
        const liquidityRespectiveReserve = this._liquidity.inventory.reduce(
            (prev, cur) => prev.add(cur.getReserveQty()),
            ECs.zero()
        );

        const curTickRespectiveReserve = this.currentTick
            .getTargetReserve()
            .sub(this.currentTick.getCurrentReserve());

        return liquidityRespectiveReserve.add(curTickRespectiveReserve);
    }
}
