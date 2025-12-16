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
            <div class="h-dvh w-dvw flex flex-col items-center justify-center p-[20px] lg:p-[40px]">
                <div class="flex flex-col gap-[100px] lg:gap-[50px] items-center justify-center">
                    <h1 class="text-white font-extrabold w-full lg:w-[750px] 2xl:w-[1000px] text-center text-[42px] lg:text-[64px] 2xl:text-[86px] font-main">
                        a DEX that solves the impermanent loss problem
                    </h1>
                    <Button
                        onClick={props.toggleSim}
                        class="self-stretch lg:self-center justify-center hover:[&>svg>path]:stroke-white transition-colors"
                    >
                        <p>see the demo</p>
                        <SimIcon />
                    </Button>
                </div>
            </div>

            <div class="mt-[100px] lg:mt-[280px] p-[20px] lg:p-[40px] flex flex-col gap-[200px] w-full lg:w-[780px] 2xl:w-[1000px] self-center">
                <p class="text-white font-main text-[28px] lg:text-[48px] font-bold text-center">
                    Drifty is a decentralized exchange with near-zero slippage
                    for traders and passive high-APR yield for liquidity
                    providers.
                </p>

                <p class="text-white font-main text-[28px] lg:text-[48px] font-bold text-center">
                    It uses collected fees to sell LPs’ impermanent loss as soon
                    as possible, deepening and rebalancing the liquidity in the
                    most optimal way.
                </p>

                <div class="flex flex-col items-center justify-center gap-[40px]">
                    <p class="text-white font-main text-[28px] lg:text-[48px] font-bold text-center">
                        Drifty is working in the background while you read this
                        very text.
                    </p>
                    <Button
                        class="self-stretch justify-center lg:self-center hover:[&>svg>path]:fill-white"
                        onClick={props.toggleSim}
                    >
                        <p>look closer</p>
                        <EyeIcon />
                    </Button>
                </div>

                <div class="flex flex-col items-center justify-center gap-[40px]">
                    <p class="text-white font-main text-[12px] font-bold text-center">
                        Multi-Asset Pools • 100% Passive Yield • Near-Zero
                        Slippage • Automatic Impermanent Loss Recovery •
                        Automatic Liquidity Management • Dynamic Fees • High APR
                        • Efficient Price Discovery • Single-Sided Liquidity
                        Provision • Limit Orders • Infinite Scalability •
                        Resilience • Revenue Sharing • Novel Dual-AMM Design
                    </p>

                    <p class="text-gray-400 font-main text-[28px] lg:text-[48px] font-bold text-center">
                        Coming 2026
                    </p>
                </div>
            </div>

            <footer class="mt-40 lg:mt-[260px] p-[20px] lg:p-[40px] flex flex-col lg:flex-row gap-10 lg:gap-4 justify-between items-center">
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

                <div class="flex flex-row flex-nowrap items-center gap-[8px] text-white font-main text-[12px] lg:text-[16px]">
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
