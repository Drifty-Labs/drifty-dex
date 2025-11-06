# Drifty By Example | Ep. 3.1 — Notes on Worst Tick Recovery

In [Episode 3](./ep3-il-recovery.md) we discussed how Drifty constantly works on resolving the impermanent loss, by using fees to recover the **worst** IL tick.
To keep that episode easy to digest, we didn't dive into the details of "how exactly" this **worst** IL tick is recovered, what is the exact mechanic?

Let's discuss that in detail, because this is an important topic. First of all, what's the **worst** IL tick? As you remember, Drifty has two AMMs - one for each token in the trading pair. Similar to how a human Market Maker in a CEX accumulates an inventory asset to sell later, Drifty AMMs accumulate IL in the opposite token. AMMs track their allocated ticks in real-time, including IL ticks. They know at what price they did sold each tick. The **worst** IL tick is the tick of impermanent loss (opposite asset) that was sold at the worst price compared to the current. Because of how Drifty's liquidity is always drifting with the current price, the **worst** IL tick is always the one on the edge of the IL.

Each AMM has its own **worst** IL tick. ALL Drifty's liquidity is always in between those two **worst** ticks. The system actively monitors all allocated ranges of ticks and stretches or compresses them in such a way to always match the worst IL tick of the opposite AMM.

![Fig. 1 - Worst IL ticks illustration.](./imgs/ep3/8.png)

The main job of an AMM is to increase the chance of next trade recovering the IL, little by little.

For the simplicity of our example, let's only unwrap the situation from the perspective of a single AMM in a pool (the other AMM does the same thing, but with respect to his own situation). Let's also say, that this pool has constant size fees of 1%. So, if someone buys the whole tick, they pay 1% of that tick's size as a fee on top. Let's also assume that the difference in price between two neibouring ticks is also 1%. So, if someone buys the whole tick, buying the next tick will be 1% more expensive for them.
