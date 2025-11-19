# Emulation pool review

## Strengths

-   Dual-AMM design ensures continuous coverage (stable) while concentrating liquidity (drifting) where it’s most useful.
-   RecoveryBin-first swap logic immediately uses fees and deepest underwater ticks to heal IL.
-   Backward withdrawals align exit cost with IL liability, protecting long-term LPs.
-   Strict `panic` usage keeps invariants explicit, making debugging easier.
-   Tick orchestration enforces identical absolute indices across all AMMs to prevent price drift.

## Weaknesses / risks / TODOs

-   Drifting AMMs are not yet enforced; requires keeper/oracle logic to reposition reserves and inventory bounds. Documented expectation, but code TODO remains.
-   `inventory.notifyReserveChanged()` side effects are subtle; tests needed to ensure new IL buckets don’t mix with old reserve baselines.
-   `_swap` loop will spin forever if both sides run out of liquidity (should short-circuit or throw).
-   Withdrawal loop assumes inventory exists when respective reserve > 0; add guard or clearer panic copy explaining LP accounting mismatch.
-   No validation on deposit/withdraw args (negative or zero values could corrupt state).
-   `RecoveryBin` only tracks a single worst tick; while intentional, it should be stated prominently and possibly expose state for off-chain monitoring.

## Suggested follow-ups

1. Implement keeper hooks / APIs for drifting AMM rebasing.
2. Add argument validation and friendlier error messages.
3. Instrument `_swap` with a max-iteration safeguard and metrics hooks.
4. Expand RecoveryBin telemetry (expose collateral, worst tick price) for dashboards.
5. Integration tests for synchronized tick moves and fee distribution.
