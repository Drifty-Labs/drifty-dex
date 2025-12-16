import { createSignal, onCleanup, onMount, Show } from "solid-js";
import { Button } from "./Button.tsx";
import { GithubIcon, TelegramIcon, XIcon } from "./Icons.tsx";
import { DriftyLogo } from "./Logos.tsx";

export type HeaderProps = {
    isSim: boolean;
    toggleSim: () => void;
};

export const Header = (props: HeaderProps) => {
    const [hidden, setHidden] = createSignal(true);

    const handleScroll = () => {
        setHidden(window.scrollY == 0);
    };

    onMount(() => {
        setHidden(window.scrollY == 0);
        window.addEventListener("scroll", handleScroll);
    });

    onCleanup(() => {
        window.removeEventListener("scroll", handleScroll);
    });

    return (
        <div
            classList={{
                "opacity-0": props.isSim ? false : hidden(),
                "opacity-100": props.isSim ? true : !hidden(),
            }}
            class="fixed w-dvw flex flex-row items-center gap-[10px] p-[20px] lg:p-[40px] z-50 transition-opacity bg-bg lg:bg-transparent"
        >
            <div class="flex-1">
                <DriftyLogo height={34} />
            </div>
            <div class="flex flex-row gap-[24px] items-center">
                <div class="hidden lg:flex flex-row gap-[16px]">
                    <a
                        href="https://github.com/Drifty-Labs/drifty-dex"
                        target="_blank"
                    >
                        <GithubIcon class="[&>path]:fill-gray-200 cursor-pointer hover:[&>path]:fill-white" />
                    </a>
                    <a href="https://t.me/driftyicp" target="_blank">
                        <TelegramIcon class="[&>path]:fill-gray-200 cursor-pointer hover:[&>path]:fill-white" />
                    </a>
                    <a href="https://x.com/driftyicp" target="_blank">
                        <XIcon class="[&>path]:fill-gray-200 cursor-pointer hover:[&>path]:fill-white" />
                    </a>
                </div>
                <Button
                    onClick={props.toggleSim}
                    class="text-[14px] px-[12px] py-[8px]"
                >
                    <Show when={props.isSim} fallback="see the demo">
                        return
                    </Show>
                </Button>
            </div>
        </div>
    );
};
