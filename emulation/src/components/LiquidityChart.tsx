import { createMemo, createSignal, For, Show } from "solid-js";
import { type LiquidityDigestAbsolute } from "../logic/pool.ts";
import { absoluteTickToPrice, type TwoSided } from "../logic/utils.ts";
import { CurTick } from "./CurTick.tsx";

export type LiquidityChartProps = {
    liquidity: LiquidityDigestAbsolute;
    containerWidth: number;
    containerHeight: number;
};

type RangeInner = {
    left: number;
    right: number;
    height: number;
};

type LiquidityRanges = {
    reserve?: RangeInner;
    oppositeInventory: RangeInner[];
};

export function LiquidityChart(props: LiquidityChartProps) {
    const ranges = createMemo(() => flattenRanges(props.liquidity));

    const maxHeight = createMemo(() => {
        let maxInvHeight = 0;

        for (const { height } of ranges().base.oppositeInventory) {
            const newHeight = height + (ranges().base.reserve?.height ?? 0);

            if (newHeight > maxInvHeight) {
                maxInvHeight = newHeight;
            }
        }

        for (const { height } of ranges().quote.oppositeInventory) {
            const newHeight = height + (ranges().quote.reserve?.height ?? 0);

            if (newHeight > maxInvHeight) {
                maxInvHeight = newHeight;
            }
        }

        return maxInvHeight;
    });

    const curTickWidth = () => 20;

    const baseWidth = () => {
        const baseLeft = props.liquidity.currentTick.idx + 1;
        const baseRight =
            ranges().base.reserve?.right ??
            ranges().base.oppositeInventory.length > 0
                ? ranges().base.oppositeInventory[
                      ranges().base.oppositeInventory.length - 1
                  ].right
                : undefined;

        return baseRight === undefined ? 0 : baseRight - baseLeft + 1;
    };

    const quoteWidth = () => {
        const quoteLeft =
            ranges().quote.reserve?.left ??
            ranges().quote.oppositeInventory.length > 0
                ? ranges().quote.oppositeInventory[0].left
                : undefined;
        const quoteRight = props.liquidity.currentTick.idx - 1;

        return quoteLeft === undefined ? 0 : quoteRight - quoteLeft + 1;
    };

    const horizontalSqueezeFactor = () => {
        const freeContainerWidth = props.containerWidth - curTickWidth();

        return freeContainerWidth / (baseWidth() + quoteWidth());
    };

    const verticalSqueezeFactor = () => {
        return props.containerHeight / maxHeight();
    };

    const base = () => {
        const res = ranges().base.reserve;
        const inv = ranges().base.oppositeInventory;

        if (!res && inv.length === 0) return <div class="relative empty"></div>;

        const hf = horizontalSqueezeFactor();
        const vf = verticalSqueezeFactor();

        const leftOffset = props.liquidity.currentTick.idx;

        return (
            <div
                class="relative"
                style={{
                    width: `${baseWidth() * horizontalSqueezeFactor()}px`,
                    height: props.containerHeight + "px",
                }}
            >
                <Show when={inv.length > 0}>
                    <For each={inv}>
                        {(it) => (
                            <div
                                class="absolute cursor-pointer bg-blue opacity-50 hover:opacity-100"
                                style={{
                                    left: (it.left - leftOffset) * hf + "px",
                                    bottom: (res?.height ?? 0) * vf + "px",
                                    width: (it.right - it.left + 1) * hf + "px",
                                    height: it.height * vf + "px",
                                    "background-image":
                                        "radial-gradient(black 1px, transparent 1px)",
                                    "background-size": "3px 3px",
                                }}
                                onclick={() => console.log(it)}
                            ></div>
                        )}
                    </For>
                </Show>

                <Show when={res}>
                    <div
                        class="absolute cursor-pointer bg-blue opacity-50 hover:opacity-100"
                        style={{
                            left: (res!.left - leftOffset) * hf + "px",
                            bottom: 0,
                            width: (res!.right - res!.left + 1) * hf + "px",
                            height: res!.height * vf + "px",
                        }}
                        onclick={() => console.log(res)}
                    ></div>
                </Show>
            </div>
        );
    };

    const quote = () => {
        const res = ranges().quote.reserve;
        const inv = ranges().quote.oppositeInventory;

        if (!res && inv.length === 0) return <div class="relative empty"></div>;

        const hf = horizontalSqueezeFactor();
        const vf = verticalSqueezeFactor();

        const rightOffset = props.liquidity.currentTick.idx;

        return (
            <div
                class="relative"
                style={{
                    width: `${quoteWidth() * horizontalSqueezeFactor()}px`,
                    height: props.containerHeight + "px",
                }}
            >
                <Show when={inv.length > 0}>
                    <For each={inv}>
                        {(it) => (
                            <div
                                class="absolute cursor-pointer bg-green opacity-50 hover:opacity-100"
                                style={{
                                    right: (rightOffset - it.right) * hf + "px",
                                    bottom: (res?.height ?? 0) * vf + "px",
                                    width: (it.right - it.left + 1) * hf + "px",
                                    height: it.height * vf + "px",
                                    "background-image":
                                        "radial-gradient(black 1px, transparent 1px)",
                                    "background-size": "3px 3px",
                                }}
                                onclick={() => console.log(it)}
                            ></div>
                        )}
                    </For>
                </Show>

                <Show when={res}>
                    <div
                        class="absolute cursor-pointer bg-green opacity-50 hover:opacity-100"
                        style={{
                            right: (rightOffset - res!.right) * hf + "px",
                            bottom: 0,
                            width: (res!.right - res!.left + 1) * hf + "px",
                            height: res!.height * vf + "px",
                        }}
                        onclick={() => console.log(res)}
                    ></div>
                </Show>
            </div>
        );
    };

    return (
        <div
            class="flex flex-row"
            style={{
                width: props.containerWidth + "px",
                height: props.containerHeight + "px",
            }}
        >
            {quote()}
            <CurTick
                widthPx={curTickWidth()}
                base={props.liquidity.currentTick.base}
                quote={props.liquidity.currentTick.quote}
                idx={props.liquidity.currentTick.idx}
            />
            {base()}
        </div>
    );
}

function flattenRanges(
    liquidity: LiquidityDigestAbsolute
): TwoSided<LiquidityRanges> {
    const ranges: TwoSided<LiquidityRanges> = {
        base: {
            reserve: (() => {
                const r = liquidity.base.reserve;
                if (!r) return undefined;

                const leftTick = r.peekBest().tickIdx.toAbsolute();
                const rightTick = r.peekWorst().tickIdx.toAbsolute();

                const width = rightTick - leftTick + 1;
                const qty = r.getQty();
                const height = qty / width;

                return { left: leftTick, right: rightTick, height };
            })(),
            oppositeInventory: liquidity.quote.inventory
                .map((it) => {
                    const leftTick = it.peekBest().tickIdx.toAbsolute();
                    const rightTick = it.peekWorst().tickIdx.toAbsolute();

                    const width = rightTick - leftTick + 1;
                    const qty = it.getQty();
                    const height = qty / width;

                    return { left: leftTick, right: rightTick, height };
                })
                .toSorted((a, b) => {
                    return a.left - b.left;
                }),
        },
        quote: {
            reserve: (() => {
                const r = liquidity.quote.reserve;
                if (!r) return undefined;

                const leftTick = r.peekWorst().tickIdx.toAbsolute();
                const rightTick = r.peekBest().tickIdx.toAbsolute();

                const width = rightTick - leftTick + 1;
                const avgTick = (leftTick + rightTick) / 2;
                const qty = r.getQty() * absoluteTickToPrice(avgTick, "quote");
                const height = qty / width;

                return { left: leftTick, right: rightTick, height };
            })(),
            oppositeInventory: liquidity.base.inventory
                .map((it) => {
                    const leftTick = it.peekWorst().tickIdx.toAbsolute();
                    const rightTick = it.peekBest().tickIdx.toAbsolute();

                    const width = rightTick - leftTick + 1;
                    const avgTick = (leftTick + rightTick) / 2;
                    const qty =
                        it.getQty() * absoluteTickToPrice(avgTick, "quote");
                    const height = qty / width;

                    return { left: leftTick, right: rightTick, height };
                })
                .toSorted((a, b) => {
                    return a.left - b.left;
                }),
        },
    };

    if (ranges.base.reserve && ranges.base.oppositeInventory.length > 0) {
        const isValid =
            ranges.base.reserve.right ===
            ranges.base.oppositeInventory[
                ranges.base.oppositeInventory.length - 1
            ].right;

        if (!isValid) {
            console.error(
                `Invalid base ranges: should overlap 100%`,
                ranges.base.reserve,
                ranges.base.oppositeInventory
            );
        }
    }

    if (ranges.quote.reserve && ranges.quote.oppositeInventory.length > 0) {
        const isValid =
            ranges.quote.reserve.left ===
            ranges.quote.oppositeInventory[0].left;

        if (!isValid) {
            console.error(
                `Invalid quote ranges: should overlap 100%`,
                ranges.quote.reserve,
                ranges.quote.oppositeInventory
            );
        }
    }

    return ranges;
}
