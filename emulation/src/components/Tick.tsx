export type TickProps = {
    qty: number;
    maxQty: number;
    widthPx: number;
    color: "green" | "blue";
    idx: number;
};

export function Tick(props: TickProps) {
    return (
        <div
            class="h-full relative flex flex-col justify-end"
            style={{ width: `${props.widthPx}px` }}
            data-idx={props.idx}
        >
            <div
                class="w-full opacity-70"
                style={{
                    height: `${(props.qty * 80) / props.maxQty}%`,
                    "background-color": props.color,
                }}
            ></div>
        </div>
    );
}

export type CurTickProps = {
    base: number;
    maxBaseQty: number;
    quote: number;
    maxQuoteQty: number;
    widthPx: number;
    idx: number;
};

export function CurTick(props: CurTickProps) {
    return (
        <div
            data-idx={props.idx}
            class="h-full relative flex flex-row items-end"
            style={{ width: `${props.widthPx}px` }}
        >
            <div
                class="w-1/2"
                style={{
                    height: `${(props.base * 80) / props.maxBaseQty}%`,
                    "background-color": "blue",
                }}
            ></div>

            <div
                class="w-1/2"
                style={{
                    height: `${(props.quote * 80) / props.maxQuoteQty}%`,
                    "background-color": "green",
                }}
            ></div>
        </div>
    );
}
