# Drifty By Example | Ep. 2 — Pool Basics

Welcome back! In the last episode, we talked about _why_ Drifty is a game-changer for liquidity providers. Now, let's dive into the _how_. How does Drifty actually work?

At its heart, Drifty is made of **liquidity pools**, which are just trading pairs like ETH/USDC. When you deposit tokens into a pool, you become a **Liquidity Provider (LP)**. Your goal as an LP determines which token you deposit. For instance, if you want to accumulate more ETH over time, you provide ETH. If you'd rather stack USDC, you provide USDC. It's that simple. These tokens are then used by traders to swap between the two assets in the pair.

This episode will break down the two core innovations that make Drifty's pools so smart and efficient. But first, let's get a quick mental model.

## A 60-Second Mental Model

Imagine a Drifty pool as **two separate shops** standing side-by-side.

-   **The "ETH Shop"** accepts ETH deposits from LPs and works to accumulate more ETH over time.
-   **The "USDC Shop"** accepts USDC deposits from LPs and works to accumulate more USDC over time.

Each shop is run by its own manager, an **Automated Market Maker (AMM)**. The ETH shop's AMM wants to grow your pile of ETH, and the USDC shop's AMM wants to grow your pile of USDC.

When you deposit your tokens, you're essentially giving them to one of these AMMs to manage on your behalf. "Here's my ETH," you say, "do your best to grow this pile." In return for "lending" your tokens, the AMM pays you a share of the **fees** it collects from traders.

While these two AMMs have different goals, they work as a team, always covering for each other to ensure the pool stays healthy and profitable. This teamwork is the secret behind Drifty's magic.

## Key Terms: A Quick Glossary

Before we go deeper, let's define a few key terms. Don't worry about memorizing them; we'll explain them again as we go.

-   **Reserve:** These are the tokens an AMM has ready to sell. For the ETH-AMM (our "ETH Shop"), its reserve is ETH.
-   **Inventory:** When an AMM sells its reserve, it accumulates the _other_ token in the pair. This acquired pile of tokens is its inventory. For the ETH-AMM, its inventory is the USDC it gets from traders.
-   **Impermanent Loss (IL):** This is the potential downside an LP faces. If the price of the token you deposited goes up, your AMM sells it. The inventory it gets in return might be worth less than if you had just held your original tokens. Inventory is what creates the risk of IL.
-   **Fees:** A small premium every trader pays on every swap. This is the primary income source for LPs and the fuel for Drifty's IL recovery engine.
-   **Tick:** Think of a tick as a specific price point. Ticks are the smallest unit of price change.

## How Fees Are Earned: A Simple Example

Let's walk through a concrete example to see how an AMM makes money for its LPs.

Say you provide 10 ETH to the ETH-AMM in an ETH/USDC pool. A trader comes along and wants to buy 1 ETH. At the current market rate of 4,000 USDC per ETH, they'd expect to pay 4,000 USDC. But Drifty charges a small fee, so the trader actually pays 4,040 USDC (4,000 USDC + 40 USDC fee).

Your AMM now has:

-   9 ETH (reserve)
-   4,040 USDC (inventory + fees)

Later, another trader wants to swap back. They buy those 4,000 USDC for 1.01 ETH. Your AMM now has:

-   10 ETH (back to the original reserve!)
-   40 USDC + 0.01 ETH in earned fees

The reserve recovered to its original level, _plus_ the AMM captured fees from both directions of the trade. These fees accumulate over time and are the key to everything Drifty does.

## Innovation #1: The Dual-AMM System (a.k.a. "Always Earning Fees")

An AMM's main job is to earn fees. If it isn't earning fees, it can't grow its LPs' deposits or recover from impermanent loss.

To earn fees, an AMM must have its reserve tokens available for sale at the current market price. Drifty's AMMs start by placing their reserves in a range around the current price, based on the token's average monthly volatility. This is a sensible default strategy.

Let's imagine an ETH/USDC pool. The ETH-AMM (selling ETH) places its ETH reserve just below the current price, and the USDC-AMM (selling USDC) places its USDC reserve just above.

![Fig. 1 - Basic reserve layout: two reserves (one for each amm) green and blue. Both equal sizes of avg. monthly volatility, both touching the current price. The green one is on the left of the cur price, the blue one is on the right.](./imgs/ep2/1.png)

_What you see here: A balanced pool. The ETH-AMM's reserve (green) and the USDC-AMM's reserve (blue) are positioned on either side of the current price, ready for traders moving in either direction._

This setup works great in a stable market. But what happens if the price makes a huge swing?

### When One Side Gets Depleted

Let's say the price of ETH skyrockets. Traders rush in to buy ETH from the ETH-AMM. Eventually, the AMM sells all of its ETH reserve. It's left with a big pile of USDC inventory, and its "shop" is empty.

![Fig. 2 - After price swing: the green reserve is still in the same place, the blue reserve is gone, the green dotted inventory is in its place. The current price is far on the right.](./imgs/ep2/2.png)

_What you see here: The ETH-AMM (blue) has sold all its reserve and is now holding only USDC inventory (represented by the dotted green area). Its liquidity is no longer at the current price, so it stops earning fees._

This is a problem. The ETH-AMM is now "stuck." Its inventory was acquired at lower prices, and it can't just sell it at the new, higher price without realizing a loss (this is IL!). It must wait for the price to come back down to its inventory's break-even point.

So, how does Drifty keep earning fees?

### The Safety Net: Always-On Liquidity

First, a small portion of all liquidity (about 5%) is spread thinly across the entire price range, from zero to infinity. This is handled by two additional, smaller AMMs that act as a safety net. This ensures there's always _some_ liquidity available, no matter how wild the price swings, allowing for smooth price discovery.

![Fig. 3 - Same image as fig. 2 zoomed out - a thin layer of liquidity spread evenly across all price plane is visible](./imgs/ep2/3.png)

_What you see here: A zoomed-out view showing the thin, always-on layer of liquidity that ensures the price never gets "stuck."_

This thin layer helps, but it doesn't generate a lot of fees. The real genius is how the two main AMMs cooperate.

### The Core Rule: Teamwork in Action

Remember, our ETH-AMM is stuck with only inventory. But its partner, the USDC-AMM, is in the perfect position! It sold nothing and now has a full reserve of USDC (green), ready to be deployed.

This brings us to the core rule of the Dual-AMM system:

> **The AMM with a free, movable reserve will stretch its liquidity to cover the gap from the current price back to the furthest edge of its partner's "stuck" inventory.**

Let's see what that looks like. The USDC-AMM takes its reserve and stretches it out, so one end touches the new, higher current price, and the other end connects with the far side of the ETH-AMM's inventory.

![Fig. 4-7 - Shows how green reserve of amm #1 stretches to the current price and then pulls the other edge to match the amm #2 inventory furthest tick](./imgs/ep2/4.png)
![Fig. 4-7 - Shows how green reserve of amm #1 stretches to the current price and then pulls the other edge to match the amm #2 inventory furthest tick](./imgs/ep2/5.png)
![Fig. 4-7 - Shows how green reserve of amm #1 stretches to the current price and then pulls the other edge to match the amm #2 inventory furthest tick](./imgs/ep2/6.png)
![Fig. 4-7 - Shows how green reserve of amm #1 stretches to the current price and then pulls the other edge to match the amm #2 inventory furthest tick](./imgs/ep2/7.png)

_What you see here: The animation shows the USDC-AMM (green) dynamically repositioning its reserve. It ensures liquidity is always touching the current price while also covering the entire range where its partner holds inventory._

Why this rule? It's simple but brilliant.

-   **No Gaps:** It creates a continuous, unbroken range of liquidity. Gaps don't earn fees.
-   **Always at the Price:** It guarantees that some liquidity is always at the current price, ready to "catch" the next trade, no matter which way the price moves.
-   **Teamwork:** It allows one AMM to keep earning fees while the other is waiting to recover.

### Three Possible Price Scenarios

From here, a few things can happen:

**1. The price dips and oscillates.**

This is the best-case scenario. The price moves back into the newly placed liquidity, traders go back and forth, and the USDC-AMM earns a lot of fees.

![Fig. 8 - Same as fig. 7, but the price is now inside the range of both: AMM #1 reserve and AMM #2 Inventory](./imgs/ep2/8.png)

_What you see here: The price has moved back into an optimal range where both AMMs' liquidity can be engaged, maximizing fee generation._

**2. The price keeps rising.**

The USDC-AMM simply continues to stretch its reserve to keep it touching the current price. It keeps earning fees from the continued upward trend.

![Fig. 9 - Same as fig. 7, but the price is now more on the right. The AMM #1 reserve is stretched to touch the price again.](./imgs/ep2/9.png)

_What you see here: The USDC-AMM has extended its range even further to maintain contact with the current price._

**3. The price crashes.**

A massive price reversal moves all the way back through the USDC-AMM's stretched reserve _and_ the ETH-AMM's old inventory.

![Fig. 10 - Same as fig. 7, but the price is now very far on the left. Both green ranges (amm #1 reserve and dotted amm #2 inventory) are transformed into blue (dotted amm #1 inventory and common amm #2 reserve).](./imgs/ep2/10.png)

_What you see here: A complete reversal. Now the USDC-AMM holds inventory (underwater), and the ETH-AMM has recovered its reserve._

Now the situation is completely flipped! The USDC-AMM has sold all its USDC and is now holding a bag of ETH inventory. But the ETH-AMM, having bought back all its ETH at lower prices, is now inventory-free and has a full reserve.

So what happens? We just apply the same rule again, but in reverse. The ETH-AMM stretches its reserve to cover the gap from the new current price to the edge of the USDC-AMM's inventory.

![Fig. 11-13 - Continuation of fig. 10. Applying the same rules as in figs. 4-7](./imgs/ep2/11.png)
![Fig. 11-13 - Continuation of fig. 10. Applying the same rules as in figs. 4-7](./imgs/ep2/12.png)
![Fig. 11-13 - Continuation of fig. 10. Applying the same rules as in figs. 4-7](./imgs/ep2/13.png)

_What you see here: The ETH-AMM now takes on the role of the active reserve provider, stretching to cover the gap while the USDC-AMM works to recover._

This elegant dance ensures that, no matter what the market does, one of the two AMMs is always positioned to earn fees. This constant fee stream is the engine that powers Drifty's second major innovation.

<details>
<summary>(click) <b>What happens if a new LP deposits tokens while one AMM is stretched out?</b></summary>

Great question. The new liquidity follows the same rules. If an LP deposits ETH into the ETH-AMM in our last example, that new reserve liquidity will be placed in a fresh range just below the current price (spanning the average monthly volatility), ready to earn fees immediately.

![Fig. 14](./imgs/ep2/14.png)

_What you see here: New LP deposits create fresh liquidity ranges positioned optimally for the current market conditions._

</details>

</br>

## Innovation #2: Automatic IL Recovery

Now for the really exciting part. How does Drifty use those fees to automatically recover impermanent loss and reduce slippage for traders?

It works just like a professional market maker would: **it uses profits from one area to offset losses in another.**

Thanks to the Dual-AMM system, an active pool is always earning fees. When there's no IL, these fees are compounded back into the reserve, growing the deposits of LPs. But when an AMM is holding inventory that is "underwater" (i.e., its break-even price is higher than the current market price), the fees are used to fix the problem.

### Understanding the Inventory Problem

Let's look at an AMM that has some IL. It has some reserve tokens ready to sell, but it's also holding some inventory acquired at higher prices. Each small slice of this inventory is a **tick.**

![Fig. 15 - A state of an AMM with IL. Current price in the middle. To the left - 10 dotted green inventory (IL) ticks. To the right - 10 common blue reserve ticks.](./imgs/ep2/15.png)

_What you see here: This AMM holds inventory (dotted green ticks on the left) that is "underwater." The current price is in the middle, and its reserve (blue ticks on the right) is ready to be sold._

The farther a tick is from the current price, the worse its position. The tick farthest to the left represents the biggest unrealized loss.

### The Recovery Mechanism

Now, a trader comes along wanting to execute a swap that would require the AMM to sell some of its inventory.

![Fig. 16 - Same as fig. 15, but with a pending reserve -> inventory trade.](./imgs/ep2/16.png)

_What you see here: A trader wants to buy inventory from the AMM. This is the perfect opportunity for recovery._

Another DEX would just sell the inventory tick closest to the current price, likely at a small loss. Drifty does something much smarter.

If the AMM has earned enough fees, it targets the **worst inventory tick**—the one furthest from the current price, representing the biggest loss. It calculates exactly how much value (from its fee surplus) needs to be added to this worst tick to make it break-even at the current price.

![Fig. 17 - Same as fig. 16, but with fees added](./imgs/ep2/17.png)

_What you see here: The earned fees are being allocated to subsidize the worst inventory tick, preparing it for sale at the current price._

Then, it "tops up" that worst tick with the needed fees and uses this combined liquidity to fulfill the trade. In effect, it takes the liquidity from the worst price point and **stacks it at the current price.**

![Fig. 18 - Same as fig. 17, but last IL tick is stacked on top of the first IL tick](./imgs/ep2/18.png)

_What you see here: The worst, most "underwater" inventory tick is subsidized with fees and moved to the current price to be sold, effectively deepening the liquidity where it's needed most._

### Why This Is Powerful

This is an incredibly powerful mechanism. Here's why:

1.  **Deeper Liquidity & Lower Slippage:** By stacking the recovered liquidity at the current price, the pool becomes much deeper right where the trading action is. Deeper liquidity means traders experience less **slippage** (the difference between the expected and executed price).

2.  **A Virtuous Cycle:** Lower slippage makes trading more attractive. More traders mean more trading volume. More volume means more fees are generated. And more fees mean the AMM can recover its remaining IL even faster. It's a positive feedback loop.

As each inventory tick is sold, it's converted back into the AMM's reserve. If fee income is high, the AMM can even recover multiple "worst ticks" at once, creating an incredibly deep market for traders. If fees are low, it might only recover a small piece of the worst tick, but the process never stops.

<details>
<summary>
<b>When one AMM recovers its IL, does the other AMM's reserve automatically concentrate?</b>
</summary>

Yes, absolutely! As the first AMM's inventory range shrinks, the second AMM (which was stretching its reserve to cover it) can now shrink its own range. This concentrates its liquidity over a tighter area, creating an even deeper market and further reducing slippage. The system automatically becomes more efficient as it heals itself. This is the beauty of Drifty's design—powerful, emergent behavior from a few simple rules.

</details>

</br>

## So What Does This All Mean?

These two systems—the Dual-AMM and Automatic IL Recovery—are what make Drifty a true "set-and-forget" DEX. They provide a hands-free experience for LPs while creating a highly efficient market for traders.

Think about it: the pool automatically adjusts to market conditions, always keeps liquidity where it matters, and systematically works to eliminate IL using the fees it earns. The genius isn't in some over-engineered, complex algorithm, but in the emergent harmony of two simple, robust rules.

For LPs, this means you can deposit your tokens and let the system work for you. For traders, it means consistently deeper liquidity and better prices. For the ecosystem, it means healthier, more sustainable pools that don't rely on external incentives.

---

#### Read Next

(coming soon) [Ep. 3 — Multi-Asset Pools]()

---

## FAQ

<details>
<summary><b>Why split the pool into two AMMs? Why not just have one?</b></summary>

Splitting the pool into two AMMs makes the system both simpler and more powerful. Each AMM can track its own inventory and reserve independently, which is much cleaner than trying to manage both assets in a single entity.

As a consequence of this separation, we get a neat feature that's impossible in a single-AMM design: we can move each AMM's reserve separately from the other. This is what enables the dynamic "stretching" behavior—when one AMM gets stuck with inventory, the other can freely reposition its reserve to keep earning fees. A single AMM managing both assets couldn't do this.

</details>

<br/>

<details>
<summary><b>What does "frame of reference" mean when providing liquidity?</b></summary>

It refers to your goal. If you are bullish on ETH and want to accumulate more of it, you provide ETH to the ETH-AMM. The system will then work to grow your ETH stack. If you'd rather earn a yield in a stablecoin, you provide USDC to the USDC-AMM. Your deposited asset is your "frame of reference" for success.

</details>

<br/>

<details>
<summary><b>Is the "average monthly volatility" range a fixed setting?</b></summary>

No, it's dynamic. The pool itself constantly measures recent price volatility on-chain and adjusts this range automatically. This helps the AMMs make smarter decisions about where to place liquidity based on current market conditions.

</details>

<br/>

<details>
<summary><b>Why is there a thin 5% layer of liquidity across the whole price range?</b></summary>

This acts as a crucial safety net. During extreme price moves (a "black swan" event), this ensures that there is never a point where there's _zero_ liquidity. This prevents the price from getting stuck and allows the market to always find a path, no matter how volatile things get. These are actually two additional proportional AMMs that also participate in IL recovery.

</details>

<br/>

<details>
<summary><b>Why does the IL recovery focus on the "worst" tick first?</b></summary>

It's a matter of efficiency and risk management. By tackling the inventory that represents the biggest loss first, the AMM systematically reduces its overall risk. Clearing the worst positions first makes the entire inventory healthier and easier to manage.

</details>

<br/>

<details>
<summary><b>Does IL recovery mean I'll never lose money?</b></summary>

Drifty is designed to _recover_ from impermanent loss over time, using the fees generated by an active pool. The goal is that, for any reasonably active trading pair, your initial deposit is protected and grows. However, no system can offer an absolute guarantee against loss, especially in highly volatile or inactive markets.

</details>

<br/>

<details>
<summary><b>How does stacking liquidity lower slippage?</b></summary>

Slippage happens when a large trade "eats through" all the available tokens at a certain price, forcing the rest of the order to be filled at worse prices. By taking liquidity from a far-off price and stacking it at the current price, Drifty creates a much thicker "wall" of tokens, absorbing trades with less price impact.

</details>

<br/>

<details>
<summary><b>Does this work for any token pair?</b></summary>

Yes, the model works for any pair of assets. It is most effective in pools with consistent trading volume, as that volume generates the fees needed to power the IL recovery engine.

</details>

<br/>

<details>
<summary><b>Do I have to actively manage my position?</b></summary>

No. This is the core benefit of Drifty. Once you deposit your tokens, the Dual-AMM and IL Recovery systems handle all the adjustments and rebalancing automatically. It's a truly passive experience.

</details>

<br/>

<details>
<summary><b>What if there aren't enough fees to recover the IL?</b></summary>

The recovery process is proportional to the fees earned. If trading volume is low, recovery will be slower. If volume is high, recovery will be much faster. The system will patiently wait, accumulating fees, until it has enough surplus to begin selling off inventory at a break-even price.

</details>

<br/>

<details>
<summary><b>Can I withdraw my liquidity at any time?</b></summary>

Yes, you can withdraw your liquidity at any time. You'll receive your proportional share of the AMM's current holdings (reserve plus any inventory), along with your accumulated fees.

</details>

<br/>

<details>
<summary><b>What happens during extreme market volatility?</b></summary>

The thin 5% layer of liquidity ensures price discovery is always possible. Meanwhile, the Dual-AMM system adapts by stretching reserves to maintain fee generation. The more volatile the market, the more fees are generated, which accelerates IL recovery.

</details>

<br/>

**If you have more questions, don't hesitate to ask in the [Telegram group](https://t.me/driftyicp).**
