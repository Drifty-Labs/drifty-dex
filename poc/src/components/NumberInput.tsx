import { createSignal, onCleanup, onMount } from "solid-js";
import { DownIcon, UpIcon } from "./Icons.tsx";

export type NumberInputProps = {
    value: number;
    onChange: (v: number) => void;
    unit: string;
};

export const NumberInput = (props: NumberInputProps) => {
    const [_, setInt] = createSignal<number | undefined>();
    const [isIncPressed, setIsIncPressed] = createSignal(false);
    const [isDecPressed, setIsDecPressed] = createSignal(false);

    onMount(() => {
        setInt(
            setInterval(() => {
                if (isIncPressed()) handleInc();
                if (isDecPressed()) handleDec();
            }, 100)
        );
    });

    onCleanup(() => {
        setInt((i) => {
            clearInterval(i);
            return undefined;
        });
    });

    const handleInc = () => {
        if (props.value < 100) props.onChange(props.value + 1);
    };

    const handleDec = () => {
        if (props.value > 1) props.onChange(props.value - 1);
    };

    return (
        <div class="flex flex-row gap-[12px] p-[12px] items-center w-[135px] bg-bg1">
            <div class="flex flex-row gap-[5px] h-[20px] text-white font-main flex-1">
                <p class="leading-[20px] text-[32px] font-normal">
                    {Math.floor(props.value)}
                </p>
                <div class="flex flex-col justify-end items-center">
                    <p class="text-[10px]">{props.unit}</p>
                </div>
            </div>
            <div class="flex flex-col items-center gap-[5px]">
                <UpIcon
                    size={10}
                    onClick={handleInc}
                    class="[&>path]:fill-gray-200 hover:[$>path]:fill-white cursor-pointer"
                    onDown={() => setIsIncPressed(true)}
                    onUp={() => setIsIncPressed(false)}
                    onLeave={() => setIsIncPressed(false)}
                />
                <DownIcon
                    size={10}
                    onClick={handleDec}
                    class="[&>path]:fill-gray-200 hover:[$>path]:fill-white cursor-pointer"
                    onDown={() => setIsDecPressed(true)}
                    onUp={() => setIsDecPressed(false)}
                    onLeave={() => setIsDecPressed(false)}
                />
            </div>
        </div>
    );
};
