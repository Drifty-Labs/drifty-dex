## Drifty Pools — Risk Analysis (with Mitigations)

This document summarizes key risks in Drifty’s pool design (Dual-AMM, stretching, fee-powered IL recovery, and an always-on liquidity layer), and the mitigation techniques planned or available.

### Important Note

As was said in [previous documents](./ep1-why-drifty.md), Drifty is designed in favor of **retail LPs** - non-professional individual, who provide liquidity to pools, but rarely spend time actually managing it. This is crucial in any comparison with other DEXs: they often assume there are professional LPs, who effectively keep the trading pair healthy. Drifty assumes **there are none** such professionals and attempts to make every trading pair healthy, only having retail's liquidity at disposal.

Everytime you think "in Uniswap V3 this part works better because you can manually reposition", remember, that retail LPs rarely repositions in general.

### Baseline mechanics (context)

-   Price is discrete by **log ticks**: $p(i)=1.0001^i$. The **current price** is the price of the active tick.
-   Each pair uses a **Dual-AMM** model (one per asset “frame of reference”), plus a thin **always-on** liquidity component across the full range.
-   **IL measurement (for fees / recovery decisions):** IL is computed as _value vs hold_ — “If I withdraw now and sell at the current price (assuming $0$ slippage), do I break even vs what I originally spent to acquire that inventory?”
-   Recovery happens **during swap settlement** by using accumulated fees to selectively sell from the most underwater inventory tick(s). (“Stacking” is a visual analogy; nothing is literally moved.)

---

## 1) Structural Liquidity Risks

### 1A) Stretch “thinning” under strong trends (low liquidity sensitivity)

**Risk:** When one AMM depletes reserve and holds mostly underwater inventory, the partner AMM “stretches” reserve to keep a continuous tradable path from the current tick back to the partner’s inventory edge. As the covered range widens, effective depth per tick falls roughly with $1/W$, where $W$ is the stretched width (in ticks).

**Impacts:**

-   **Higher slippage** during large directional moves, especially in small/retail pools.
-   **Lower volume** if routing avoids high-slippage execution, which reduces fees and slows recovery (a negative loop: slippage $\rightarrow$ less volume $\rightarrow$ less fees $\rightarrow$ slower healing $\rightarrow$ prolonged thin state).

**Comparison vs a passive V3-like DEX (retail rarely re-ranges):**

-   Passive V3-like often fails by being **out-of-range** (near-zero fees) during trends.
-   Drifty stays **in-range more often**, but can become **thin** if stretching spans very large ranges.

**Mitigations**

1. **Stretching optimization (anchor to “best” inventory tick, not “worst”):**  
   Stretch from the _closest-to-break-even / closest-to-price_ inventory tick (accounting for gaps), reducing $W$ and increasing near-price depth.
    - _Tradeoff:_ deepest underwater tail may be connected later (slower worst-tail cleanup), but execution quality improves materially in stressed regimes.
2. **Add a non-stretching near-price AMM band:**  
   In addition to the always-on layer, introduce AMMs that do **not stretch** and instead keep liquidity concentrated around current price, e.g. within $\pm$ average monthly volatility. Fund them by allocating a portion of deposits that would otherwise go to stretching AMMs.
    - _Benefit:_ preserves consistent near-price depth during trends; stabilizes execution and supports volume/fees when stretching would otherwise thin out.
    - _Tradeoff:_ more parameters (allocation %, band width) and more internal routing dynamics.

---

## 2) Recovery Engine / Low Volume Risks

### 2A) Fee dependence: slow recovery in low-volume or stagnant pools

**Risk:** IL recovery is fee-powered. If organic trading volume is low, recovery can be slow even if the mechanism is working as designed.

**Impacts:**

-   Longer periods where inventory remains underwater.
-   Lower realized returns for LPs who exit before recovery completes.

**Mitigations**

1. **Maintain competitive execution to sustain routing:**  
   The near-price non-stretch AMM band and improved stretching geometry both reduce slippage, helping keep routing/volume from collapsing during stress.
2. **Dynamic fee “decay on inactivity” (planned):**  
   High fees are useful when the pool is vulnerable, but can suppress flow. A rule that **lowers fees when trades stop** helps escape the “high fee $\rightarrow$ no volume $\rightarrow$ no recovery” trap.
    - _Tradeoff:_ if volume does not return, lower fees don’t help; if volume returns, lower fees reduce per-trade revenue but can increase total fee intake via higher throughput.

---

## 3) Market Manipulation & Adversarial Flow

### 3A) “Rubber band” manipulation during stretched states

**Vector:** If stretching updates **per swap**, an attacker can force price movement while the pool is already thin, then rely on the stretching response to maintain a manipulable geometry long enough to extract value via cross-venue arbitrage.

**Mitigation: delayed / logarithmic stretching (timer-based)**

-   Replace instantaneous per-swap stretching with gradual convergence (e.g., move halfway to the target every 2–3 minutes, then halfway again, etc.).
-   _Why it helps:_ reduces the attacker’s ability to trigger immediate geometry changes; allows arbitrage to correct temporary divergence using always-on liquidity before the pool fully adapts into an attacker-favorable thin configuration.
-   _Tradeoff:_ slower responsiveness in genuine fast markets.

### 3B) Recovery-event predictability (“sandwiching” the recovery effect)

Even though recovery is computed inside swap settlement (not a separate “restack” transaction), the _effect_—improved near-price depth from subsidized inventory—can still be targeted by sophisticated flow.

**Mitigation: cap “recovery sell” concentration per tick (alternating rule)**
Implement a rule such as:

-   After selling a recovered IL slice from a single inventory tick, **force a normal (non-recovered) sell** before attempting another recovered slice again.

This preserves recovery, but avoids creating an oversized “free wall” at the current tick that invites cheap arbitrage.

-   _Benefit:_ reduces extractable value from predictable depth jumps at the active tick; encourages smoother price response.
-   _Tradeoff:_ recovery may take more trades to complete in some states.

### 3C) Toxic flow / adverse selection (arb drains the “best” liquidity)

**Risk:** Any time a venue makes execution unusually favorable at the active price, informed traders/arbitrageurs will tend to take it first. If external price discovery moves ahead, they can consume liquidity quickly.

**Mitigations**

-   The **alternating rule** above (don’t continuously sell recovered slices at the same tick).

## Bottom line

Drifty’s design targets the most common failure mode of passive concentrated-liquidity markets: retail LPs being out-of-range and earning little during the regimes that matter. The main risks concentrate around (i) thinness created by stretching in strong trends, (ii) low-volume slow recovery, and (iii) extractable value around dynamic state changes.

The mitigation set directly addresses those weaknesses while preserving the “set-and-forget” advantages that matter most in retail-led pools.
