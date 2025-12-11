import { createSignal, onMount } from "solid-js";
import { delay } from "../logic/utils.ts";

export const Logo = (props: { class?: string }) => {
    const [offset, setOffset] = createSignal({ l: 0, t: 0 });
    const [blueOffset, setBlueOffset] = createSignal({ l: 0, t: 0 });
    const [redOffset, setRedOffset] = createSignal({ l: 0, t: 0 });
    const [greenOffset, setGreenOffset] = createSignal({ l: 0, t: 0 });

    onMount(async () => {
        while (true) {
            const r = Math.random();
            if (r < 0.9) {
                setOffset({ l: 0, t: 0 });
            } else {
                const l = Math.floor(Math.random() * 400 - 200);
                const t = Math.floor(Math.random() * 400 - 200);

                setOffset({ l, t });
            }

            const r1 = Math.random();
            if (r1 < 0.5) {
                setBlueOffset({ l: 0, t: 0 });
            } else {
                const l = Math.floor(Math.random() * 10 - 5);
                const t = Math.floor(Math.random() * 10 - 5);

                setBlueOffset({ l, t });
            }

            const r2 = Math.random();
            if (r2 < 0.5) {
                setGreenOffset({ l: 0, t: 0 });
            } else {
                const l = Math.floor(Math.random() * 10 - 5);
                const t = Math.floor(Math.random() * 10 - 5);

                setGreenOffset({ l, t });
            }

            const r3 = Math.random();
            if (r3 < 0.5) {
                setRedOffset({ l: 0, t: 0 });
            } else {
                const l = Math.floor(Math.random() * 10 - 5);
                const t = Math.floor(Math.random() * 10 - 5);

                setRedOffset({ l, t });
            }

            await delay(Math.floor(Math.random() * 300) + 50);
        }
    });

    return (
        <div class={props.class}>
            <div
                style={{ left: offset().l + "px", top: offset().t + "px" }}
                class="relative text-[200px] font-logo"
            >
                <p class="relative z-10 text-white">drifty</p>

                <p
                    style={{
                        left: blueOffset().l + "px",
                        top: blueOffset().t + "px",
                    }}
                    class="absolute z-0 text-blue "
                >
                    drifty
                </p>

                <p
                    style={{
                        left: redOffset().l + "px",
                        top: redOffset().t + "px",
                    }}
                    class="absolute left-[-2px] top-[-2px] z-0 text-red"
                >
                    drifty
                </p>

                <p
                    style={{
                        left: greenOffset().l + "px",
                        top: greenOffset().t + "px",
                    }}
                    class="absolute left-[4px] top-[-2px] z-0 text-green "
                >
                    drifty
                </p>
            </div>
        </div>
    );
};
