import { createEffect, createMemo, For } from "solid-js";
import { type LiquidityAbsolute } from "../logic/pool.ts";
import { CurTick, Tick } from "./Tick.tsx";
import { panic } from "../logic/utils.ts";

export type LiquidityChartProps = {
    liquidity: LiquidityAbsolute;
};

export function LiquidityChart(props: LiquidityChartProps) {
    const baseTicks = createMemo(() =>
        fillTickGaps(props.liquidity.base, true)
    );
    const quoteTicks = createMemo(() =>
        fillTickGaps(props.liquidity.quote, false)
    );

    createEffect(() => {
        console.log("base", baseTicks().length);
        console.log("quote", quoteTicks().length);
    });

    return (
        <div class="w-full h-[500px] bg-bg flex flex-row gap-0.5 flex-nowrap">
            <div class="flex flex-row gap-0.5 flex-nowrap">
                <For each={baseTicks()}>
                    {([idx, qty]) => (
                        <Tick
                            idx={idx}
                            widthPx={5}
                            qty={qty}
                            maxQty={props.liquidity.maxBase}
                            color="blue"
                        />
                    )}
                </For>
            </div>
            <div class="flex flex-row gap-0.5 flex-nowrap">
                <CurTick
                    idx={props.liquidity.currentTick.idx}
                    widthPx={40}
                    base={props.liquidity.currentTick.base}
                    quote={props.liquidity.currentTick.quote}
                    maxBaseQty={props.liquidity.maxBase}
                    maxQuoteQty={props.liquidity.maxQuote}
                />
            </div>
            <div class="flex flex-row gap-0.5 flex-nowrap">
                <For each={quoteTicks()}>
                    {([idx, qty]) => (
                        <Tick
                            idx={idx}
                            widthPx={5}
                            qty={qty}
                            maxQty={props.liquidity.maxQuote}
                            color="green"
                        />
                    )}
                </For>
            </div>
        </div>
    );
}

function fillTickGaps(
    tickMap: Map<number, number>,
    inverted: boolean
): [number, number][] {
    const result: [number, number][] = [];
    const ticks = [...tickMap.entries()];

    let prevIdx: undefined | number = undefined;
    for (
        let i = inverted ? ticks.length - 1 : 0;
        inverted ? i >= 0 : i < ticks.length;
        inverted ? i-- : i++
    ) {
        if (prevIdx === undefined) {
            prevIdx = ticks[i][0];
            result.push(ticks[i]);
            continue;
        }

        const curIdx = ticks[i][0];

        // making sure we cover all the gaps with ghost ticks
        if (curIdx > prevIdx) {
            while (curIdx - prevIdx > 1) {
                result.push([prevIdx + 1, 0]);
                prevIdx += 1;
            }
        } else if (curIdx < prevIdx) {
            while (prevIdx - curIdx > 1) {
                result.push([prevIdx - 1, 0]);
                prevIdx -= 1;
            }
        } else {
            panic("PrevIdx should not be equal to CurIdx");
        }

        prevIdx = curIdx;
        result.push(ticks[i]);
    }

    return result;
}
