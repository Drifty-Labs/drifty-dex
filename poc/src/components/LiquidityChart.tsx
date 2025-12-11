import { createMemo, For, Show } from "solid-js";
import { type LiquidityDigestAbsolute } from "../logic/pool.ts";
import { chunkify, type Side, type TwoSided } from "../logic/utils.ts";
import { Beacon } from "../logic/beacon.ts";
import { POOL } from "./Simulation.tsx";
import { absoluteTickToPrice } from "../logic/ecs.ts";

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
        const r = ranges();
        const rBaseHeight = r.base.reserve?.height ?? 0;
        const rQuoteHeight = r.quote.reserve?.height ?? 0;

        let maxInvHeight = Math.max(rBaseHeight, rQuoteHeight);

        for (const { height } of r.base.oppositeInventory) {
            const newHeight = height + rBaseHeight;

            if (newHeight > maxInvHeight) {
                maxInvHeight = newHeight;
            }
        }

        for (const { height } of r.quote.oppositeInventory) {
            const newHeight = height + rQuoteHeight;

            if (newHeight > maxInvHeight) {
                maxInvHeight = newHeight;
            }
        }

        return maxInvHeight;
    });

    const curTickWidth = () => 0;

    const baseWidth = () => {
        const r = ranges();

        const baseLeft = props.liquidity.currentTick.idx + 1;
        const baseRight =
            r.base.reserve?.right ??
            (r.base.oppositeInventory.length > 0
                ? r.base.oppositeInventory[r.base.oppositeInventory.length - 1]
                      .right
                : undefined);

        return baseRight === undefined ? 0 : baseRight - baseLeft + 1;
    };

    const quoteWidth = () => {
        const r = ranges();

        const quoteLeft =
            r.quote.reserve?.left ??
            (r.quote.oppositeInventory.length > 0
                ? r.quote.oppositeInventory[0].left
                : undefined);

        const quoteRight = props.liquidity.currentTick.idx - 1;

        return quoteLeft === undefined ? 0 : quoteRight - quoteLeft + 1;
    };

    const horizontalSqueezeFactor = () => {
        const ctw = curTickWidth();
        const bw = baseWidth();
        const qw = quoteWidth();

        const freeContainerWidth = props.containerWidth - ctw;

        return freeContainerWidth / (bw + qw);
    };

    const verticalSqueezeFactor = () => {
        return props.containerHeight / maxHeight();
    };

    const base = () => {
        const r = ranges();
        const res = r.base.reserve;
        const inv = combineRanges("base", r.base.oppositeInventory);

        if (!res && inv.length === 0) return <div class="relative empty"></div>;

        const hf = horizontalSqueezeFactor();
        const vf = verticalSqueezeFactor();

        const bw = baseWidth();

        const leftOffset = props.liquidity.currentTick.idx;
        const resHeight = res
            ? Math.min(res.height * vf, props.containerHeight / 2)
            : 0;

        return (
            <div
                class="relative"
                style={{
                    width: `${bw * hf}px`,
                    height: props.containerHeight + "px",
                }}
            >
                <Show when={inv.length > 0}>
                    <For each={inv}>
                        {(it) => (
                            <div
                                class="absolute bg-blue"
                                style={{
                                    left: (it.left - leftOffset) * hf + "px",
                                    bottom: resHeight + "px",
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
                        class="absolute bg-blue"
                        style={{
                            left: (res!.left - leftOffset) * hf + "px",
                            bottom: 0,
                            width: (res!.right - res!.left + 1) * hf + "px",
                            height: resHeight + "px",
                        }}
                        onclick={() => console.log(res)}
                    ></div>
                </Show>
            </div>
        );
    };

    const quote = () => {
        const r = ranges();
        const res = r.quote.reserve;
        const inv = combineRanges("quote", r.quote.oppositeInventory);

        if (!res && inv.length === 0) return <div class="relative empty"></div>;

        const hf = horizontalSqueezeFactor();
        const vf = verticalSqueezeFactor();
        const qw = quoteWidth();

        const rightOffset = props.liquidity.currentTick.idx;
        const resHeight = res
            ? Math.min(res.height * vf, props.containerHeight / 2)
            : 0;

        return (
            <div
                class="relative"
                style={{
                    width: `${qw * hf}px`,
                    height: props.containerHeight + "px",
                }}
            >
                <Show when={inv.length > 0}>
                    <For each={inv}>
                        {(it) => {
                            const width = (it.right - it.left + 1) * hf;
                            const height = it.height * vf;
                            const right = (rightOffset - it.right) * hf;
                            const bottom = resHeight;

                            return (
                                <div
                                    class="absolute bg-green"
                                    style={{
                                        right: right + "px",
                                        bottom: bottom + "px",
                                        width: width + "px",
                                        height: height + "px",
                                        "background-image":
                                            "radial-gradient(black 1px, transparent 1px)",
                                        "background-size": "3px 3px",
                                    }}
                                    onclick={() => console.log(it)}
                                ></div>
                            );
                        }}
                    </For>
                </Show>

                <Show when={res}>
                    <div
                        class="absolute bg-green "
                        style={{
                            right: (rightOffset - res!.right) * hf + "px",
                            bottom: 0,
                            width: (res!.right - res!.left + 1) * hf + "px",
                            height: resHeight + "px",
                        }}
                        onclick={() => console.log(res)}
                    ></div>
                </Show>
            </div>
        );
    };

    const leftPrice = () => {
        const r = ranges();
        const leftTick =
            r.quote.reserve?.left ??
            (r.quote.oppositeInventory.length > 0
                ? r.quote.oppositeInventory[0].left
                : undefined);

        return leftTick !== undefined
            ? Beacon.base(POOL).price(leftTick)
            : undefined;
    };

    const rightPrice = () => {
        const r = ranges();
        const rightTick =
            r.base.reserve?.right ??
            (r.base.oppositeInventory.length > 0
                ? r.base.oppositeInventory[r.base.oppositeInventory.length - 1]
                      .right
                : undefined);

        return rightTick !== undefined
            ? Beacon.base(POOL).price(rightTick)
            : undefined;
    };

    const curTickLeft = () => {
        return horizontalSqueezeFactor() * quoteWidth();
    };

    return (
        <div
            class="relative flex flex-row opacity-40"
            style={{
                width: props.containerWidth + "px",
                height: props.containerHeight + "px",
            }}
        >
            <div class="relative">
                {quote()}
                <Show when={leftPrice() !== undefined}>
                    <p class="absolute left-0 bottom-[-2em]">
                        {(leftPrice() ?? 0).toString(2)}
                    </p>
                </Show>
            </div>
            <div class="relative">
                {base()}
                <Show when={rightPrice() !== undefined}>
                    <p class="absolute right-0 bottom-[-2em]">
                        {(rightPrice() ?? 0).toString(2)}
                    </p>
                </Show>
            </div>

            <div
                class="h-dvh w-[2px] bg-white absolute flex flex-col items-center justify-end py-20"
                style={{
                    left: curTickLeft() - 1 + "px",
                }}
            >
                <p class="text-red font-semibold text-xl">
                    {absoluteTickToPrice(
                        props.liquidity.currentTick.idx,
                        "base",
                        "reserve"
                    ).toString(2)}
                </p>
            </div>
        </div>
    );
}

function combineRanges(side: Side, ranges: RangeInner[]): RangeInner[] {
    if (ranges.length <= 11) return ranges;

    const firstRange = side === "base" ? ranges[ranges.length - 1] : ranges[0];
    const otherRanges =
        side === "base"
            ? ranges.slice(0, ranges.length - 1)
            : ranges.slice(1, ranges.length);

    const chunks = chunkify(otherRanges, 10);
    const combinedRanges: RangeInner[] = [];

    for (const chunk of chunks) {
        const left = chunk[0].left;
        const right = chunk[chunk.length - 1].right;
        const height =
            chunk.reduce((prev, cur) => prev + cur.height, 0) / chunk.length;

        combinedRanges.push({ left, right, height });
    }

    return side === "base"
        ? [firstRange, ...combinedRanges]
        : [...combinedRanges, firstRange];
}

function flattenRanges(
    liquidity: LiquidityDigestAbsolute
): TwoSided<LiquidityRanges> {
    const ranges: TwoSided<LiquidityRanges> = {
        base: {
            reserve: (() => {
                const r = liquidity.base.reserve;
                if (!r) return undefined;

                const height = r.getReserveQty().toNumber() / r.getWidth();

                return { left: r.getLeft(), right: r.getRight(), height };
            })(),
            oppositeInventory: liquidity.quote.inventory.map((it) => {
                const avgTick = (it.getLeft() + it.getRight()) / 2;

                const height =
                    it
                        .getReserveQty()
                        .mul(Beacon.quote(POOL).price(avgTick))
                        .toNumber() / it.getWidth();

                return { left: it.getLeft(), right: it.getRight(), height };
            }),
        },
        quote: {
            reserve: (() => {
                const r = liquidity.quote.reserve;
                if (!r) return undefined;

                const avgTick = (r.getLeft() + r.getRight()) / 2;
                const qty = r
                    .getReserveQty()
                    .mul(Beacon.quote(POOL).price(avgTick))
                    .toNumber();
                const height = qty / r.getWidth();

                return { left: r.getLeft(), right: r.getRight(), height };
            })(),
            oppositeInventory: liquidity.base.inventory.map((it) => {
                const qty = it.getReserveQty().toNumber();
                const height = qty / it.getWidth();

                return { left: it.getLeft(), right: it.getRight(), height };
            }),
        },
    };

    return ranges;
}
