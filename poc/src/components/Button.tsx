import { type JSXElement } from "solid-js";

export type ButtonProps = {
    children: JSXElement;
    onClick?: () => void;
    class?: string;
};

export const Button = (props: ButtonProps) => {
    return (
        <button
            type="submit"
            class="p-[16px] bg-white border-0 flex flex-row items-center gap-[16px] font-main font-bold text-[16px] cursor-pointer text-bg [&>svg>path]:fill-bg hover:bg-bg1 hover:text-white hover:[&>svg>path]:fill-white transition-all"
            classList={{ [props.class!]: !!props.class }}
            onclick={props.onClick}
        >
            {props.children}
        </button>
    );
};
