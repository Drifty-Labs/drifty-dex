import Ecs "ecs";
import Int32 "mo:base/Int32";
import Nat "mo:base/Nat";

module {
    public type Tick = Int32;

    public let MIN_TICK: Tick = -887272;
    public let MAX_TICK: Tick = 887272;

    public let NULL_TICK: Tick = Int32.maxValue;

    public let BASE_PRICE_E38S = 1_0001_0_000_000_000_000_000_000_000_000_000_000_000;

    public func tick_to_price_e38s(tick: Tick): Nat {
        return Ecs.pow(BASE_PRICE_E38S, 38, Int32.toInt(tick));
    };

    public func next_price_e38s(cur_price_e38s: Nat): Nat {
        return Ecs.mul(cur_price_e38s, BASE_PRICE_E38S, 38);
    };

    public func prev_price_e38s(cur_price_e38s: Nat): Nat {
        return Ecs.div(cur_price_e38s, BASE_PRICE_E38S, 38);
    };

    public let MIN_TICK_SPACING: Tick = 1;
    public let MAX_TICK_SPACING: Tick = 64;
    public let MIN_TICK_SPACING_BOUNDARY: Tick = 10;
    public let MAX_TICK_SPACING_BOUNDARY: Tick = 640;
}