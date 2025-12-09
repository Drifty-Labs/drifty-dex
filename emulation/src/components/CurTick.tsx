import { Beacon } from "../logic/beacon.ts";
import { ECs } from "../logic/ecs.ts";

export type CurTickProps = {
    base: ECs;
    quote: ECs;
    widthPx: number;
    idx: number;
};

export function CurTick(props: CurTickProps) {
    const quote = () => props.quote.mul(Beacon.quote().price(props.idx));
    const max = () => quote().add(props.base);

    const quoteHeight = () =>
        Math.max((quote().toNumber() * 100) / max().toNumber(), 1);
    const baseHeight = () =>
        Math.max((props.base.toNumber() * 100) / max().toNumber(), 1);

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
