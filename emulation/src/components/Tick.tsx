import { absoluteTickToPrice } from "../logic/utils.ts";

export type TickProps = {
    qty: number;
    maxQty: number;
    widthPx: number;
    isBase: boolean;
    idx: number;
};

export function Tick(props: TickProps) {
    const handleClick = () => {
        console.log(props);
    };

    const qty = () =>
        props.isBase
            ? props.qty
            : props.qty * absoluteTickToPrice(props.idx, "quote");

    const height = () => Math.max((qty() * 80) / props.maxQty, 1);

    return (
        <div
            class="h-full relative flex flex-col justify-end opacity-50 hover:opacity-100"
            style={{ width: `${props.widthPx}px` }}
            data-idx={props.idx}
            onclick={handleClick}
        >
            <div
                class="w-full"
                style={{
                    height: `${height()}%`,
                    "background-color": props.isBase ? "blue" : "green",
                }}
            ></div>
        </div>
    );
}

export type CurTickProps = {
    base: number;
    maxBaseQty: number;
    quote: number;
    widthPx: number;
    idx: number;
};

export function CurTick(props: CurTickProps) {
    const quote = () => props.quote * absoluteTickToPrice(props.idx, "quote");
    const max = () => quote() + props.base;

    const quoteHeight = () => Math.max((quote() * 80) / max(), 1);
    const baseHeight = () => Math.max((props.base * 80) / max(), 1);

    return (
        <div
            data-idx={props.idx}
            class="h-full relative flex flex-row items-end"
            style={{ width: `${props.widthPx}px` }}
            onclick={() => console.log(props)}
        >
            <div
                class="w-1/2"
                style={{
                    height: `${quoteHeight()}%`,
                    "background-color": "green",
                }}
            ></div>

            <div
                class="w-1/2"
                style={{
                    height: `${baseHeight()}%`,
                    "background-color": "blue",
                }}
            ></div>
        </div>
    );
}
