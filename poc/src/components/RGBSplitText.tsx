import { createSignal, onMount, Show } from "solid-js";
import { delay } from "../logic/utils.ts";

export type IRGBSplitTextProps = {
    class?: string;
    text: string;
    size: number;
    italic?: boolean;
    weight?: number;
    split?: boolean;
};

export const RGBSplitText = (props: IRGBSplitTextProps) => {
    const [offset, setOffset] = createSignal({ l: 0, t: 0 });
    const [blueOffset, setBlueOffset] = createSignal({ l: 0, t: 0 });
    const [redOffset, setRedOffset] = createSignal({ l: 0, t: 0 });
    const [greenOffset, setGreenOffset] = createSignal({ l: 0, t: 0 });

    onMount(async () => {
        while (true) {
            const r = Math.random();
            const ts = props.split ? 0.99 : 0.9;

            if (r < ts) {
                setOffset({ l: 0, t: 0 });
            } else {
                const l = Math.floor(
                    Math.random() * (props.size * 2) - props.size
                );
                const t = Math.floor(
                    Math.random() * (props.size * 2) - props.size
                );

                setOffset({ l, t });
            }

            if (props.split) {
                const s10 = props.size / 10;
                const s20 = props.size / 20;

                const r1 = Math.random();
                if (r1 < 0.5) {
                    setBlueOffset({ l: 0, t: 0 });
                } else {
                    const l = Math.floor(Math.random() * s10 - s20);
                    const t = Math.floor(Math.random() * s10 - s20);

                    setBlueOffset({ l, t });
                }

                const r2 = Math.random();
                if (r2 < 0.5) {
                    setGreenOffset({ l: 0, t: 0 });
                } else {
                    const l = Math.floor(Math.random() * s10 - s20);
                    const t = Math.floor(Math.random() * s10 - s20);

                    setGreenOffset({ l, t });
                }

                const r3 = Math.random();
                if (r3 < 0.5) {
                    setRedOffset({ l: 0, t: 0 });
                } else {
                    const l = Math.floor(Math.random() * s10 - s20);
                    const t = Math.floor(Math.random() * s10 - s20);

                    setRedOffset({ l, t });
                }
            }

            await delay(Math.floor(Math.random() * 300) + 50);
        }
    });

    return (
        <div class="inline-block" classList={{ [props.class!]: !!props.class }}>
            <div
                style={{
                    left: offset().l + "px",
                    top: offset().t + "px",
                    "font-size": props.size + "px",
                    "font-family": props.italic
                        ? "JetBrainsMonoItalic"
                        : "JetBrainsMono",
                    "font-weight": props.weight ?? 500,
                }}
                class="relative"
            >
                <h1 class="relative z-10 text-white">{props.text}</h1>

                <Show when={props.split}>
                    <h1
                        style={{
                            left: blueOffset().l + "px",
                            top: blueOffset().t + "px",
                        }}
                        class="absolute z-0 transition-all text-blue "
                    >
                        {props.text}
                    </h1>

                    <h1
                        style={{
                            left: redOffset().l + "px",
                            top: redOffset().t + "px",
                        }}
                        class="absolute left-[-2px] top-[-2px] transition-all z-0 text-red"
                    >
                        {props.text}
                    </h1>

                    <h1
                        style={{
                            left: greenOffset().l + "px",
                            top: greenOffset().t + "px",
                        }}
                        class="absolute left-[4px] top-[-2px] transition-all z-0 text-green "
                    >
                        {props.text}
                    </h1>
                </Show>
            </div>
        </div>
    );
};
