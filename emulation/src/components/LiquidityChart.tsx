import { createEffect, createMemo, For } from "solid-js";
import { type LiquidityDigestAbsolute } from "../logic/pool.ts";
import { CurTick, Tick } from "./Tick.tsx";
import { panic } from "../logic/utils.ts";
import { OrderedMap } from "@js-sdsl/ordered-map";

export type LiquidityChartProps = {
    liquidity: LiquidityDigestAbsolute;
};

export function LiquidityChart(props: LiquidityChartProps) {
    const baseTicks = createMemo(() => fillTickGaps(props.liquidity.base));
    const quoteTicks = createMemo(() => fillTickGaps(props.liquidity.quote));

    return (
        <div class="w-full h-[500px] bg-bg flex flex-row gap-0.5 flex-nowrap">
            <div class="flex flex-row gap-0.5 flex-nowrap">
                <For each={quoteTicks()}>
                    {([idx, qty]) => (
                        <Tick
                            idx={idx}
                            widthPx={5}
                            qty={qty}
                            maxQty={props.liquidity.maxBase}
                            isBase={false}
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
                />
            </div>
            <div class="flex flex-row gap-0.5 flex-nowrap">
                <For each={baseTicks()}>
                    {([idx, qty]) => (
                        <Tick
                            idx={idx}
                            widthPx={5}
                            qty={qty}
                            maxQty={props.liquidity.maxBase}
                            isBase
                        />
                    )}
                </For>
            </div>
        </div>
    );
}

function fillTickGaps(tickMap: OrderedMap<number, number>): [number, number][] {
    const result: [number, number][] = [];

    let prevIdx: undefined | number = undefined;

    tickMap.forEach(([idx, qty]) => {
        const curIdx = idx;

        if (prevIdx === undefined) {
            prevIdx = curIdx;
            result.push([idx, qty]);
            return;
        }

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
        result.push([idx, qty]);
    });

    return result;
}
