# Drifty By Example | Ep. 1 — Why Drifty?

If you have questions after reading this document, please refer to the [FAQ section below](#faq).

Let's explore _why_ Drifty represents a significant step forward in decentralized finance (DeFi), particularly in how it addresses long-standing challenges for liquidity providers, traders, and token projects.

## The Liquidity Challenge in Traditional DEXs

A key problem in traditional Automated Market Makers (AMMs) like Uniswap revolves around **Impermanent Loss (IL)** and its impact on liquidity providers, especially for emerging projects.

-   **Token Holders vs. Liquidity Providers:** A project's token holders are typically invested in its success, hoping for the token's price to appreciate. However, if they provide liquidity in a traditional AMM, they face IL. When their token's price increases, they can end up with fewer tokens than if they had simply held them. This is because IL forces a gradual sale of the appreciating asset at a disadvantageous average price. This creates a fundamental conflict: the very outcome token holders desire (price appreciation) is penalized when they provide liquidity.
-   **The Professional LP Mindset:** Large, established crypto assets often attract professional liquidity providers. These are sophisticated entities who treat tokens as instruments for profit, without emotional attachment. They use complex strategies to manage IL and maximize fee income. Attracting these professional LPs often requires substantial incentives (like token emissions), which can be a significant financial burden for new projects.

This situation makes it difficult for emerging projects to build deep, organic liquidity from their own communities. Community members are often the largest holders of the project's tokens but are understandably hesitant to risk IL.

**Drifty's primary mission is to resolve this conflict.** It empowers regular token holders to become liquidity providers confidently, without the traditional risks of impermanent loss, transforming them into active participants in their project's financial ecosystem.

## A New Approach to Mitigating Impermanent Loss

Impermanent Loss is a well-known problem with many proposed solutions. Drifty's approach is different.

-   **Common Strategies and Their Limitations:**

    -   **Rebalancers:** These tools automatically adjust an LP's position to keep it within a certain range. While helpful, they can be complex, may rely on off-chain components, and their fees can erode profits.
    -   **Incentive-Based Systems (e.g., Aerodrome Finance):** Aerodrome uses a vote-escrow model (`ve(3,3)`) where users lock its native token (AERO) to vote on which pools receive AERO emission rewards. This subsidizes LPs to help offset IL, but it relies on the perceived value of the reward token and doesn't eliminate IL itself.
    -   **Yield Tokenization (e.g., Pendle Finance):** Pendle separates yield-bearing assets into principal and yield tokens, allowing users to trade future yields. This creates speculative opportunities rather than directly solving IL for standard AMM liquidity positions.
    -   **Lending-DEX Integrations:** Some platforms combine lending protocols with DEXs, deploying lent assets into liquidity pools. These aim to provide a passive return while managing the underlying complexities but often rely heavily on stablecoins and abstract the LP experience into a lending one.

-   **Drifty's Unique Design:**
    Instead of adding layers to existing AMM designs, Drifty reimagines the core mechanics of a liquidity pool. It is engineered from the ground up with IL recovery as a primary goal.

    -   **No External Incentives:** Drifty doesn't rely on issuing reward tokens or complex financial derivatives to compensate for IL.
    -   **Focus on Core Dynamics:** It optimizes the relationship between liquidity providers and traders to extract maximum value from the trading process itself, channeling this value directly to LPs.

-   **Capital Preservation:** The system is designed so that, over time, LPs should always end up with more tokens than they deposited.
-   **Internet Computer Native:** This novel architecture, which uses "personal" user-managed canisters for scalability, is uniquely suited to the Internet Computer and would be difficult to implement efficiently on other blockchains or in centralized environments.

## The Benefits

### For Liquidity Providers (LPs):

-   **Reduced Risk & Capital Growth:** Drifty is designed to recover impermanent loss over time. This means LPs are less exposed to the risk of their initial capital decreasing in quantity due to price volatility. The goal is for LPs to see their deposited token amount grow.
-   **Simplicity:** Providing liquidity is straightforward: select a pool and deposit a single asset. No complex manual rebalancing or strategy adjustments are needed.
-   **True Passive Income:** Once liquidity is provided to a well-chosen pool, the system manages it automatically, allowing for a genuinely passive income experience with a degree of predictability in IL resolution.

### For Traders:

-   **Deep, Active Liquidity:** Drifty's system keeps liquidity concentrated around the current price and minimizes idle funds, giving traders access to deeper, more effective liquidity.
-   **Minimal Slippage & Better Prices:** Concentrated liquidity means lower slippage on trades, so traders get better execution at prices closer to the market rate.
-   **A Virtuous Cycle:** Better trading conditions attract more traders, which generates more fees. These fees further incentivize LPs, leading to even deeper liquidity — a positive feedback loop.

### For Token Projects:

-   **Community-Driven Liquidity:** Drifty makes it attractive for a project's token holders to provide liquidity, as the risk of IL is actively mitigated. This unlocks a project's own community as its primary liquidity source.
-   **Increased Scarcity & Market Health:** When community members lock their tokens in Drifty pools, it can reduce the circulating supply and increase scarcity. Deeper liquidity also contributes to a healthier, more stable market for the token.
-   **Cost-Effective Token Utility:** Projects can offer their communities a way to earn passively on their holdings without funding expensive LP incentive programs. This adds immediate utility to any token, even for projects in early development.

### For the Internet Computer Ecosystem:

-   **Revitalizing DeFi on the IC:** Drifty has the potential to significantly boost the DeFi sector on the Internet Computer, which has seen lower Total Value Locked (TVL) and trading volumes compared to other chains.
-   **Making ckTokens Viable:** Chain-Key (ck) tokens — assets bridged from other blockchains like Bitcoin or Ethereum — become much more useful on the IC if they can be traded with low slippage. Drifty provides the efficient trading environment needed for ckTokens to thrive.
-   **Attracting Capital and Users:** A successful, innovative DEX like Drifty can draw more users, developers, and capital to the Internet Computer, strengthening the entire ecosystem.

In essence, Drifty is not just another DEX; it's a foundational shift in how liquidity provision can work, designed to be fairer, simpler, and more beneficial for everyone — especially the everyday token holder.

#### Read Next

[Ep. 2 — Pool Basics](./ep2-pool-basics.md)

---

## FAQ

<details>
<summary>What is "Impermanent Loss"? It sounds scary.</summary>
Impermanent Loss (IL) is a risk you take when you provide tokens to a liquidity pool. If the price of the token you deposited goes up a lot, you can end up with less money than if you had just held onto the token in your wallet. Drifty is designed to help you get that value back over time.
</details>

<br/>

<details>
<summary>So, if I put my tokens in Drifty, I won't lose money if the price goes up?</summary>
That's the goal. Drifty has a system to "recover" the value you would have lost from Impermanent Loss. It might take some time, but the aim is to make sure you profit from a price increase, similar to how you would if you just held the tokens.
</details>

<br/>

<details>
<summary>What does it mean to "provide liquidity"?</summary>
Providing liquidity means you are lending your tokens to a decentralized exchange (like Drifty) so that other people can trade with them. In return, you earn a small fee from every trade that happens in that pool.
</details>

<br/>

<details>
<summary>Why would a project's own community members be hesitant to provide liquidity?</summary>
Because of Impermanent Loss. If they believe in a project, they expect its token price to rise. In traditional exchanges, this price rise would cause them to lose some of their tokens, which feels like a penalty for supporting the project. Drifty aims to fix this.
</details>

<br/>

<details>
<summary>How is Drifty different from other platforms that try to solve Impermanent Loss?</summary>
Many other platforms use complex strategies or give you extra reward tokens to cover your losses. Drifty's approach is built into its core design. It doesn't need to pay you with extra tokens; instead, it manages the trading process in a way that naturally helps you recover from IL.
</details>

<br/>

<details>
<summary>What does "single-sided liquidity" mean?</summary>
In many exchanges, you have to deposit a pair of tokens (like ETH and USDC) in equal value. In Drifty, you can provide just one of the tokens in a pair. For example, you can provide only your project's token without needing to also provide a stablecoin.
</details>

<br/>

<details>
<summary>What are "dynamic fees"?</summary>
The trading fees on Drifty change based on market conditions. When there's a lot of trading and price movement (volatility), the fees go up, which means liquidity providers earn more. When the market is calm, fees are lower to encourage more trading.
</details>

<br/>

<details>
<summary>What is the Internet Computer (IC)? Why is Drifty built on it?</summary>
The Internet Computer is a type of blockchain that is very fast, scalable and has special features like timers, reverse gas model and secure randomness. Drifty's unique design requires those special features.
</details>

<br/>

<details>
<summary>What are "ckTokens"?</summary>
ckTokens (Chain-Key tokens) are tokens from other blockchains, like Bitcoin (ckBTC) or Ethereum (ckETH), that have been "bridged" or brought over to the Internet Computer. Drifty makes it easier and cheaper to trade these tokens on the IC.
</details>

<br/>

**If you have more questions, don't hesitate to ask in the [Telegram group](https://t.me/driftyicp).**
