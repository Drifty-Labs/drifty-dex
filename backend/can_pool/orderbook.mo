import Map "mo:base/Map";
import Int32 "mo:base/Int32";
import Runtime "mo:base/Runtime";
import Types "mo:base/Types";
import Ticks "../shared/ticks";
import Ecs "../shared/ecs";


module {
    /// Represents the order book, which stores aggregated liquidity data per tick.
    public type Orderbook = {
        /// A map from a tick (price level) to its corresponding liquidity data.
        ticks: Map.Map<Ticks.Tick, TickData>;
    };

    /// Creates a new, empty order book.
    public func new(): Orderbook {
        return {
            ticks = Map.empty<Ticks.Tick, TickData>()
        };
    };

    /// Returns an iterator over the ticks in the order book, starting from a specific tick.
    /// The iteration can be in ascending or descending order of ticks.
    public func get_tick_iter(self: Orderbook, from_tick: Ticks.Tick, base_to_quote: Bool): Types.Iter<(Ticks.Tick, TickData)> {
        return if (base_to_quote) { 
            Map.entriesFrom(self.ticks, Int32.compare, from_tick);
        } else {
            Map.reverseEntriesFrom(self.ticks, Int32.compare, from_tick);
        };
    };

    /// Arguments for adding liquidity to a tick.
    public type AddLiquidityArgs = {
        /// Whether the liquidity is for the base asset.
        is_base: Bool;
        /// The tick to which liquidity is being added.
        tick: Ticks.Tick;
        /// The quantity of liquidity to add, in e38s.
        qty_in_e38s: Nat;
    };

    /// The result of adding liquidity.
    public type AddLiquidityResult = {
        /// The ID of the order batch the liquidity was added to.
        order_batch_id: Nat64;
    };

    /// Adds liquidity to a specific tick in the order book.
    /// Liquidity is processed in batches. When adding liquidity, a batch ID is returned.
    /// If you check the tick later and the batch ID is the same, you need to check how much was swapped.
    /// If the batch ID is greater, all of your liquidity has been swapped.
    public func add_liquidity(self: Orderbook, args: AddLiquidityArgs): AddLiquidityResult {
        let (tick_data, exists) = switch (Map.get(self.ticks, Int32.compare, args.tick)) {
            case (?t) { (t, true) };
            case (null) { (empty_tick(), false) };
        };

        let order_batch_id = if (tick_data.current_batch_filled_qty_e38s == 0) {
            tick_data.current_batch_total_qty_e38s += args.qty_in_e38s;
            tick_data.batch_id
        } else {
            tick_data.next_batch_qty_e38s += args.qty_in_e38s;
            tick_data.batch_id + 1
        };

        if (not exists) {
            Map.add(self.ticks, Int32.compare, args.tick, tick_data);
        };

        return { order_batch_id = order_batch_id };
    };

    /// The result of removing liquidity.
    public type RemoveLiquidityResult = {
        /// The quantity of the base asset returned.
        base_qty_out_e38s: Nat;
        /// The quantity of the quote asset returned.
        quote_qty_out_e38s: Nat;
    };

    /// Removes liquidity from a specific tick.
    public func remove_liquidity(self: Orderbook, add_args: AddLiquidityArgs, add_result: AddLiquidityResult): RemoveLiquidityResult {
        let ?tick_data = Map.get(self.ticks, Int32.compare, add_args.tick) else Runtime.unreachable();

        let (base_qty_out_e38s, quote_qty_out_e38s) = if (tick_data.batch_id == add_result.order_batch_id - 1) {
            // The batch was not yet processed; the user's liquidity is in the original asset.
            tick_data.next_batch_qty_e38s -= add_args.qty_in_e38s;

            if (add_args.is_base) { (add_args.qty_in_e38s, 0) } else { (0, add_args.qty_in_e38s) }
        } else if (tick_data.batch_id == add_result.order_batch_id) {
            // The batch is currently being processed; the user's liquidity may be partially or fully filled.
            let order_share_e38s = Ecs.div(add_args.qty_in_e38s, tick_data.current_batch_total_qty_e38s, 38);
            let order_filled_in_e38s = Ecs.mul(tick_data.current_batch_filled_qty_e38s, order_share_e38s, 38);
            let order_remainder_in_e38s: Nat = add_args.qty_in_e38s - order_filled_in_e38s;

            let price_e38s = if (add_args.is_base) { 
                Ticks.tick_to_price_e38s(add_args.tick) 
            } else { 
                Ecs.inv(Ticks.tick_to_price_e38s(add_args.tick), 38) 
            };
            let order_swapped_e38s = Ecs.mul(order_filled_in_e38s, price_e38s, 38);

            tick_data.current_batch_total_qty_e38s -= add_args.qty_in_e38s;
            tick_data.current_batch_filled_qty_e38s -= order_filled_in_e38s;
            
            if (add_args.is_base) {
                tick_data.out_quote_e38s -= order_swapped_e38s;

                (order_filled_in_e38s, order_remainder_in_e38s)
            } else {
                tick_data.out_base_e38s -= order_swapped_e38s;

                (order_remainder_in_e38s, order_filled_in_e38s)
            }
        } else if (tick_data.batch_id < add_result.order_batch_id) {
            // The batch was already processed; the user's liquidity is fully filled.
            let price_e38s = if (add_args.is_base) { 
                Ticks.tick_to_price_e38s(add_args.tick) 
            } else { 
                Ecs.inv(Ticks.tick_to_price_e38s(add_args.tick), 38) 
            };
            let order_swapped_e38s = Ecs.mul(add_args.qty_in_e38s, price_e38s, 38);

            if (add_args.is_base) {
                tick_data.out_quote_e38s -= order_swapped_e38s;

                (0, order_swapped_e38s)
            } else {
                tick_data.out_base_e38s -= order_swapped_e38s;

                (order_swapped_e38s, 0)
            }
        } else {
            // Order batch ID can never be less than tick batch ID - 1.
            Runtime.unreachable();
        };

        // TODO: make sure it works even if there are some precision errors
        if (tick_is_empty(tick_data)) {
            Map.remove(self.ticks, Int32.compare, add_args.tick);
        };

        return { base_qty_out_e38s = base_qty_out_e38s; quote_qty_out_e38s = quote_qty_out_e38s };
    };

    /// Data stored for each tick in the order book.
    public type TickData = {
        /// The ID of the current batch being processed.
        var batch_id: Nat64;
        /// The quantity of liquidity in the next batch, in e38s.
        var next_batch_qty_e38s: Nat;

        /// The total quantity of liquidity in the current batch, in e38s.
        var current_batch_total_qty_e38s: Nat;
        /// The quantity of liquidity in the current batch that has been filled, in e38s.
        var current_batch_filled_qty_e38s: Nat;

        /// The total quantity of the base asset that has been swapped out from this tick.
        var out_base_e38s: Nat;
        /// The total quantity of the quote asset that has been swapped out from this tick.
        var out_quote_e38s: Nat;
    };

    /// Arguments for a swap that continues until the input quantity is exhausted.
    public type SwapTillExhaustedArgs = {
        /// The tick at which the swap is occurring.
        tick: Ticks.Tick;
        /// The quantity to be swapped, in e38s.
        qty_in_e38s: Nat;
        /// The direction of the swap (base to quote or quote to base).
        base_to_quote: Bool;
    };

    /// The result of a swap_till_exhausted operation.
    public type SwapTillExhaustedResult = {
        /// The remaining input quantity that was not swapped.
        reminder_in_e38s: Nat;
        /// The quantity of the output asset received from the swap.
        qty_out_e38s: Nat;
    };

    /// Performs a swap at a given tick, consuming liquidity until the input amount is fully used or the tick's liquidity is exhausted.
    public func swap_till_exhausted(tick_data: TickData, args: SwapTillExhaustedArgs): SwapTillExhaustedResult {
        let price_e38s = if (args.base_to_quote) { Ticks.tick_to_price_e38s(args.tick) } else { Ecs.inv(Ticks.tick_to_price_e38s(args.tick), 38) };
        let total_need_out_e38s = Ecs.mul(args.qty_in_e38s, price_e38s, 38);
        var need_out_e38s = total_need_out_e38s;

        let tick_remainder_out_e38s: Nat = tick_data.current_batch_total_qty_e38s - tick_data.current_batch_filled_qty_e38s;

        // If we can completely cover the swap with the current batch, do that and return early.
        if (tick_remainder_out_e38s >= need_out_e38s) {
            tick_data.current_batch_filled_qty_e38s += need_out_e38s;
            
            if (args.base_to_quote) {
                tick_data.out_base_e38s += args.qty_in_e38s;
            } else {
                tick_data.out_quote_e38s += args.qty_in_e38s;
            };

            return { reminder_in_e38s = 0; qty_out_e38s = need_out_e38s };
        };

        // If we need more liquidity, remember the covered and uncovered portions.
        var covered_need_out_e38s = tick_remainder_out_e38s;
        need_out_e38s -= tick_remainder_out_e38s;
        
        // If there is another batch, try to cover with it.
        if (tick_next_batch(tick_data)) {
            let tick_remainder_out_e38s: Nat = tick_data.current_batch_total_qty_e38s - tick_data.current_batch_filled_qty_e38s;

            // If the next batch has enough liquidity to completely cover the swap, use it and return early.
            if (tick_remainder_out_e38s >= need_out_e38s) {
                tick_data.current_batch_filled_qty_e38s += need_out_e38s;
                
                if (args.base_to_quote) {
                    tick_data.out_base_e38s += args.qty_in_e38s;
                } else {
                    tick_data.out_quote_e38s += args.qty_in_e38s;
                };

                return { reminder_in_e38s = 0; qty_out_e38s = need_out_e38s + covered_need_out_e38s };
            };

            // If we still need more liquidity, remember the covered and uncovered portions.
            covered_need_out_e38s += tick_remainder_out_e38s;
            need_out_e38s -= tick_remainder_out_e38s;
        };

        // We used all available liquidity from the tick.
        tick_data.current_batch_filled_qty_e38s := tick_data.current_batch_total_qty_e38s;
        let used_qty_in_e38s = Ecs.mul(Ecs.one(38) - Ecs.div(need_out_e38s, total_need_out_e38s, 38), args.qty_in_e38s, 38);
        let reminder_in_e38s: Nat = args.qty_in_e38s - used_qty_in_e38s;

        if (args.base_to_quote) {
            tick_data.out_base_e38s += used_qty_in_e38s;
        } else {
            tick_data.out_quote_e38s += used_qty_in_e38s;
        };

        return { reminder_in_e38s = reminder_in_e38s; qty_out_e38s = covered_need_out_e38s };
    };

    /// Creates an empty TickData structure.
    func empty_tick(): TickData {
        return {
            var batch_id = 0;
            var next_batch_qty_e38s = 0;

            var current_batch_total_qty_e38s = 0;
            var current_batch_filled_qty_e38s = 0;

            var out_base_e38s = 0;
            var out_quote_e38s = 0;
        };
    };

    /// Checks if a tick has any remaining liquidity or swapped assets.
    func tick_is_empty(tick_data: TickData): Bool {
        return tick_data.next_batch_qty_e38s == 0 and 
            tick_data.current_batch_total_qty_e38s == 0 and 
            tick_data.out_base_e38s == 0 and 
            tick_data.out_quote_e38s == 0;
    };

    /// Moves to the next batch of liquidity for a tick, if available.
    func tick_next_batch(tick_data: TickData): Bool {
        if (tick_data.next_batch_qty_e38s == 0) return false;

        tick_data.current_batch_total_qty_e38s := tick_data.next_batch_qty_e38s;
        tick_data.current_batch_filled_qty_e38s := 0;
        tick_data.batch_id += 1;

        return true;
    };
}
