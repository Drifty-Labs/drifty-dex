import { Button } from "../Button.tsx";
import {
    CopyrightIcon,
    EyeIcon,
    GithubIcon,
    SimIcon,
    TelegramIcon,
    XIcon,
} from "../Icons.tsx";
import { BurnLogo } from "../Logos.tsx";

export type LandingPageProps = {
    isSim: boolean;
    toggleSim: () => void;
};

export const LandingPage = (props: LandingPageProps) => {
    return (
        <main class="relative min-h-dvh overflow-hidden flex flex-col">
            <div class="h-dvh w-dvw flex flex-col items-center justify-center">
                <div class="flex flex-col gap-[50px] items-center justify-center">
                    <h1 class="text-white font-extrabold w-[750px] text-center text-[64px] font-main">
                        a DEX that solves the impermanent loss problem
                    </h1>
                    <Button
                        onClick={props.toggleSim}
                        class="hover:[&>svg>path]:stroke-white transition-colors"
                    >
                        <p>see the demo</p>
                        <SimIcon />
                    </Button>
                </div>
            </div>

            <div class="pt-[280px] flex flex-col gap-[200px] w-[780px] self-center">
                <p class="text-white font-main text-[48px] font-bold text-center">
                    Drifty is a decentralized exchange with near-zero slippage
                    for traders and high-APR set-and-forget yield for liquidity
                    providers.
                </p>

                <p class="text-white font-main text-[48px] font-bold text-center">
                    It uses collected fees to sell LPs’ impermanent loss as soon
                    as possible, deepening and rebalancing the liquidity in the
                    most optimal way.
                </p>

                <p class="text-white font-main text-[48px] font-bold text-center">
                    Drifty is working in the background while you read this very
                    text.
                </p>

                <Button
                    class="self-center hover:[&>svg>path]:fill-white"
                    onClick={props.toggleSim}
                >
                    <p>look closer</p>
                    <EyeIcon />
                </Button>

                <p class="text-white font-main text-[48px] font-bold text-center">
                    Coming Q4 2026
                </p>
            </div>

            <footer class="mt-[260px] p-[40px] flex flex-row gap-4 justify-between items-center">
                <div class="flex flex-row items-center gap-[16px]">
                    <a
                        href="https://github.com/Drifty-Labs/drifty-dex"
                        target="_blank"
                        class="p-[12px] bg-bg hover:bg-white hover:[&>svg>path]:fill-bg transition-colors"
                    >
                        <GithubIcon class="[&>path]:fill-gray-200 cursor-pointer transition-colors" />
                    </a>
                    <a
                        href="https://t.me/driftyicp"
                        target="_blank"
                        class="p-[12px] bg-bg hover:bg-white hover:[&>svg>path]:fill-bg transition-colors"
                    >
                        <TelegramIcon class="[&>path]:fill-gray-200 cursor-pointer transition-colors" />
                    </a>
                    <a
                        href="https://x.com/driftyicp"
                        target="_blank"
                        class="p-[12px] bg-bg hover:bg-white hover:[&>svg>path]:fill-bg transition-colors"
                    >
                        <XIcon class="[&>path]:fill-gray-200 cursor-pointer transition-colors" />
                    </a>
                </div>

                <div class="flex flex-row items-center gap-[8px] text-white font-main text-[16px]">
                    <p>with</p>
                    <BurnLogo height={24} />
                    <p>from BURN community</p>
                    <CopyrightIcon class="[&>path]:fill-white" />
                    <p>{new Date().getFullYear()}</p>
                </div>
            </footer>
        </main>
    );
};
