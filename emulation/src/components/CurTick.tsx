import { absoluteTickToPrice } from "../logic/utils.ts";

export type CurTickProps = {
    base: number;
    quote: number;
    widthPx: number;
    idx: number;
};

export function CurTick(props: CurTickProps) {
    const quote = () => props.quote * absoluteTickToPrice(props.idx, "quote");
    const max = () => quote() + props.base;

    const quoteHeight = () => Math.max((quote() * 100) / max(), 1);
    const baseHeight = () => Math.max((props.base * 100) / max(), 1);

    return (
        <div
            data-idx={props.idx}
            class="h-full relative flex flex-row items-end pl-0.5 pr-0.5 opacity-50 hover:opacity-100 cursor-pointer"
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
