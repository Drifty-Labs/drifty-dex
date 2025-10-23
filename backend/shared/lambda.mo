import Runtime "mo:base/Runtime";
import Array "mo:base/Array";
import Iter "mo:base/Iter";

module {
    public type Lambda = Nat;

    public let BUCKET_COUNT: Nat = 10;
    public func buckets_indices_iter(): Iter.Iter<Nat> { 
        return Array.tabulate<Nat>(BUCKET_COUNT, func (i) { return i }).values();
    };

    public let LAMBDA_0: Lambda = 0_0445_7000000000000000000000000000000000; // uses 4.4570% liq per 0.01% price (~99% per 1%)
    public let LAMBDA_1: Lambda = 0_0068_3000000000000000000000000000000000; // uses 0.6830% liq per 0.01% price (~50% per 1%)
    public let LAMBDA_2: Lambda = 0_0028_4000000000000000000000000000000000; // uses 0.2840% liq per 0.01% price (~25% per 1%)
    public let LAMBDA_3: Lambda = 0_0010_4000000000000000000000000000000000; // uses 0.1040% liq per 0.01% price (~10% per 1%)
    public let LAMBDA_4: Lambda = 0_0005_0000000000000000000000000000000000; // uses 0.0500% liq per 0.01% price (~5% per 1%)
    public let LAMBDA_5: Lambda = 0_0002_5000000000000000000000000000000000; // uses 0.0250% liq per 0.01% price (~2.5% per 1%)
    public let LAMBDA_6: Lambda = 0_0002_0000000000000000000000000000000000; // uses 0.0200% liq per 0.01% price (~2% per 1%)
    public let LAMBDA_7: Lambda = 0_0001_6700000000000000000000000000000000; // uses 0.0167% liq per 0.01% price (~1.7% per 1%)
    public let LAMBDA_8: Lambda = 0_0001_3300000000000000000000000000000000; // uses 0.0133% liq per 0.01% price (~1.3% per 1%)
    public let LAMBDA_9: Lambda = 0_0001_0000000000000000000000000000000000; // uses 0.0100% liq per 0.01% price (~1% per 1%)

    public func bucket_idx_by_lambda_e38s(lambda_e38s: Lambda): Nat {
        if (lambda_e38s == LAMBDA_0) { return 0; };
        if (lambda_e38s == LAMBDA_1) { return 1; };
        if (lambda_e38s == LAMBDA_2) { return 2; };
        if (lambda_e38s == LAMBDA_3) { return 3; };
        if (lambda_e38s == LAMBDA_4) { return 4; };
        if (lambda_e38s == LAMBDA_5) { return 5; };
        if (lambda_e38s == LAMBDA_6) { return 6; };
        if (lambda_e38s == LAMBDA_7) { return 7; };
        if (lambda_e38s == LAMBDA_8) { return 8; };
        if (lambda_e38s == LAMBDA_9) { return 9; };
        
        Runtime.trap("Unsupported lambda value");
    };

    public func lambda_e38s_by_bucket_idx(bucket_idx: Nat): Lambda {
        return switch (bucket_idx) {
            case (0) { LAMBDA_0 }; 
            case (1) { LAMBDA_1 }; 
            case (2) { LAMBDA_2 }; 
            case (3) { LAMBDA_3 }; 
            case (4) { LAMBDA_4 }; 
            case (5) { LAMBDA_5 }; 
            case (6) { LAMBDA_6 }; 
            case (7) { LAMBDA_7 }; 
            case (8) { LAMBDA_8 }; 
            case (9) { LAMBDA_9 }; 
            case (_) { Runtime.trap("Unsupported bucket idx value"); };
        };
    };
}