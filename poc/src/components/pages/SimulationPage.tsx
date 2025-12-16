import { Show } from "solid-js";
import { Button } from "../Button.tsx";
import { NumberInput } from "../NumberInput.tsx";
import { type Metrics } from "../Simulation.tsx";
import { PauseIcon, PlayIcon } from "../Icons.tsx";

export type SimulationPageProps = {
    isSim: boolean;
    toggleSim: () => void;
    metrics: Metrics;

    speed: number;
    setSpeed: (s: number) => void;

    volatility: number;
    setVolatility: (s: number) => void;

    isRunning: boolean;
    toggleRunning: () => void;
};

export const SimulationPage = (props: SimulationPageProps) => {
    return (
        <div class="w-dvw h-dvh relative flex flex-col pt-[100px] lg:pt-[134px] pb-[20px] lg:pb-[40px] px-[20px] lg:px-[40px] font-main text-white">
            <div class="flex flex-row flex-1 justify-between">
                <div class="flex flex-col gap-[10px] items-start text-[14px] font-normal lg:text-white text-gray-400">
                    <p>
                        Day: <span class="font-bold">{props.metrics.day}</span>
                    </p>
                    <p>
                        Fee:{" "}
                        <span class="font-bold">
                            {props.metrics.curFeeFactor.toString(2)}%
                        </span>
                    </p>
                    <p>
                        Price:{" "}
                        <span class="font-bold">
                            ${props.metrics.curPrice.toString(2)}
                        </span>
                    </p>
                    <p>
                        Txn Size (avg 30d):{" "}
                        <span class="font-bold">
                            ${props.metrics.avgTxnSize.toShortString()}
                        </span>
                    </p>
                    <p>
                        24h Volume (avg 30d):{" "}
                        <span class="font-bold">
                            ${props.metrics.avgVolume.toShortString()}
                        </span>
                    </p>
                    <p>
                        24h Fees (avg 30d):{" "}
                        <span class="font-bold">
                            ${props.metrics.avgFees.toShortString()}
                        </span>
                    </p>

                    <div class="flex lg:hidden flex-col gap-[10px] text-white">
                        <p>
                            APR (avg 30d):{" "}
                            <span class="font-bold">
                                {props.metrics.avgAPR.toString(2)}%
                            </span>
                        </p>
                        <p>
                            Slippage (avg 30d):{" "}
                            <span class="font-bold">
                                {props.metrics.avgSlippage.toString(4)}%
                            </span>
                        </p>
                    </div>
                </div>

                <div class="hidden lg:flex flex-col gap-[10px] w-[280px]">
                    <div class="flex flex-row items-center justify-between">
                        <p class="font-extrabold text-[20px]">Speed</p>
                        <NumberInput
                            value={props.speed}
                            onChange={props.setSpeed}
                            unit="tx/s"
                        />
                    </div>

                    <div class="flex flex-row items-center justify-between">
                        <p class="font-extrabold text-[20px]">Volatility</p>
                        <NumberInput
                            value={props.volatility}
                            onChange={props.setVolatility}
                            unit="%/d"
                        />
                    </div>

                    <Button
                        class="self-end w-[135px] hover:[&>svg>path]:fill-white"
                        onClick={props.toggleRunning}
                    >
                        <Show
                            when={props.isRunning}
                            fallback={
                                <>
                                    <p>unpause</p>
                                    <PlayIcon />
                                </>
                            }
                        >
                            <p>pause</p>
                            <PauseIcon />
                        </Show>
                    </Button>
                </div>
            </div>

            <div class="flex flex-row gap-[10px] justify-between items-end">
                <div class="flex flex-col justify-start gap-4 lg:gap-[24px]">
                    <p class="font-extrabold text-[24px] lg:text-[36px]">
                        USD AMM
                    </p>
                    <div class="flex flex-col justify-start gap-[12px] font-normal text-[12px] lg:text-[14px]">
                        <p>
                            Reserve:{" "}
                            <span class="font-extrabold">
                                ${props.metrics.usdReserve.toShortString()}
                            </span>
                        </p>
                        <p>
                            Inventory:{" "}
                            <span class="font-extrabold">
                                ${props.metrics.usdInventory.toShortString()}
                            </span>
                        </p>
                        <p>
                            Profit:{" "}
                            <span class="font-extrabold">
                                ${props.metrics.usdProfit.toShortString()}{" "}
                                <span class="hidden lg:inline">
                                    (
                                    {props.metrics.usdProfitPercent.toString(2)}
                                    %)
                                </span>
                            </span>
                        </p>
                        <p>
                            <span class="hidden lg:inline">
                                Impermanent Loss
                            </span>
                            <span class="inline lg:hidden">IL</span>:{" "}
                            <span class="font-extrabold">
                                {props.metrics.usdIL.toString(4)}%
                            </span>
                        </p>
                    </div>
                </div>

                <div class="hidden lg:flex flex-row gap-[40px] items-center justify-center">
                    <div class="flex flex-col gap-[10px]">
                        <p class="font-extrabold text-[48px]">
                            {props.metrics.avgAPR.toString(2)}%
                        </p>
                        <p class="font-normal text-[20px]">APR (avg 30d)</p>
                    </div>

                    <div class="flex flex-col gap-[10px]">
                        <p class="font-extrabold text-[48px]">
                            {props.metrics.avgSlippage.toString(4)}%
                        </p>
                        <p class="font-normal text-[20px]">
                            Slippage (avg 30d)
                        </p>
                    </div>
                </div>

                <div class="flex flex-col justify-end gap-4 lg:gap-[24px] text-right">
                    <p class="font-extrabold text-[24px] lg:text-[36px]">
                        BTC AMM
                    </p>
                    <div class="flex flex-col justify-end gap-[12px] font-normal text-[12px] lg:text-[14px]">
                        <p>
                            Reserve:{" "}
                            <span class="font-extrabold">
                                ₿{props.metrics.btcReserve.toShortString()}
                            </span>
                        </p>
                        <p>
                            Inventory:{" "}
                            <span class="font-extrabold">
                                ₿{props.metrics.btcInventory.toShortString()}
                            </span>
                        </p>
                        <p>
                            Profit:{" "}
                            <span class="font-extrabold">
                                ₿{props.metrics.btcProfit.toShortString()}{" "}
                                <span class="hidden lg:inline">
                                    (
                                    {props.metrics.btcProfitPercent.toString(2)}
                                    %)
                                </span>
                            </span>
                        </p>
                        <p>
                            <span class="hidden lg:inline">
                                Impermanent Loss
                            </span>
                            <span class="inline lg:hidden">IL</span>:{" "}
                            <span class="font-extrabold">
                                {props.metrics.btcIL.toString(4)}%
                            </span>
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
};
