# Drifty By Example | Ep. 1 — Why Drifty?

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

[Ep. 2 — The Liquidity Pool Lifecycle](./ep2-liquidity-pool-lifecycle.md)

---

Ask questions and leave feedback via our [Telegram group](https://t.me/driftyicp).
