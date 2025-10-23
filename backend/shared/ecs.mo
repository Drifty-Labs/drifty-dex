import Nat "mo:base/Nat";
import Nat8 "mo:base/Nat8";
import Text "mo:base/Text";

/// A module for working with fixed-precision numbers, represented as Nats.
/// The precision is determined by the number of decimals.
module ECs {
    /// Precomputed powers of 10 for different decimal precisions.
    let base : [Nat] = [1, 10, 100, 1_000, 10_000, 100_000, 1_000_000, 10_000_000, 100_000_000, 1_000_000_000, 10_000_000_000, 100_000_000_000, 1_000_000_000_000, 10_000_000_000_000, 100_000_000_000_000, 1_000_000_000_000_000, 10_000_000_000_000_000, 100_000_000_000_000_000, 1_000_000_000_000_000_000, 10_000_000_000_000_000_000, 100_000_000_000_000_000_000, 1_000_000_000_000_000_000_000, 10_000_000_000_000_000_000_000, 100_000_000_000_000_000_000_000, 1_000_000_000_000_000_000_000_000, 10_000_000_000_000_000_000_000_000, 100_000_000_000_000_000_000_000_000, 1_000_000_000_000_000_000_000_000_000, 10_000_000_000_000_000_000_000_000_000, 100_000_000_000_000_000_000_000_000_000, 1_000_000_000_000_000_000_000_000_000_000, 10_000_000_000_000_000_000_000_000_000_000, 100_000_000_000_000_000_000_000_000_000_000, 1_000_000_000_000_000_000_000_000_000_000_000, 10_000_000_000_000_000_000_000_000_000_000_000, 100_000_000_000_000_000_000_000_000_000_000_000, 1_000_000_000_000_000_000_000_000_000_000_000_000, 10_000_000_000_000_000_000_000_000_000_000_000_000, 100_000_000_000_000_000_000_000_000_000_000_000_000, 1_000_000_000_000_000_000_000_000_000_000_000_000_000, 10_000_000_000_000_000_000_000_000_000_000_000_000_000];

    /// Converts a value from one decimal precision to another.
    public func convert(val: Nat, fromDecimals: Nat8, toDecimals: Nat8): Nat {
        if (fromDecimals > toDecimals) {
            return val / ECs.one(fromDecimals - toDecimals);
        } else {
            return val * ECs.one(toDecimals - fromDecimals);
        }
    };

    /// Returns the value of 1 for a given number of decimals (10^decimals).
    public func one(decimals: Nat8): Nat {
        return base[Nat8.toNat(decimals)];
    };

    /// Returns the value of 0.
    public func zero(_decimals: Nat8): Nat {
        return 0;
    };

    /// Adds two fixed-precision numbers.
    public func add(lhs: Nat, rhs: Nat, _decimals: Nat8): Nat {
        return lhs + rhs;
    };

    /// Subtracts one fixed-precision number from another.
    public func sub(lhs: Nat, rhs: Nat, _decimals: Nat8): Nat {
        return lhs - rhs;
    };

    /// Multiplies two fixed-precision numbers.
    public func mul(lhs: Nat, rhs: Nat, decimals: Nat8): Nat {
        return lhs * rhs / ECs.one(decimals);
    };

    /// Divides one fixed-precision number by another.
    public func div(lhs: Nat, rhs: Nat, decimals: Nat8): Nat {
        assert rhs > 0;
        return lhs * ECs.one(decimals) / rhs;
    };

    /// Calculates the inverse of a fixed-precision number (1 / val).
    public func inv(val: Nat, decimal: Nat8): Nat {
        return ECs.div(ECs.one(decimal), val, decimal); 
    };

    /// Squares a fixed-precision number.
    public func pow2(val: Nat, decimals: Nat8): Nat {
        return ECs.mul(val, val, decimals);
    };

    /// Calculates the square root of a fixed-precision number using binary search.
    public func sqrt(val: Nat, decimals: Nat8): Nat {
        let one = ECs.one(decimals);
        if (val == one) { return val };

        var low = 0;
        var high = val;
        if (val < one) {
            low := val; 
            high := one; 
        };

        var dif: Nat = high - low;
        let eps = 1;

        while (dif > eps) {
            let mid = (high + low) / 2;
            let mid2 = ECs.mul(mid, mid, decimals);

            if (mid2 == val) { return mid; }
            else if (mid2 > val) { high := mid; }
            else { low := mid; };

            dif := high - low;
        };

        return low;
    };

    /// Calculates the power of a fixed-precision number (x^exp) using exponentiation by squaring.
    public func pow(x: Nat, x_decimals: Nat8, exp: Int): Nat {
        if (exp < 0) {
            return ECs.pow(ECs.inv(x, x_decimals), x_decimals, -exp);
        } else if (exp == 0) {
            return ECs.one(x_decimals);
        } else if (exp % 2 == 0) {
            return ECs.pow(ECs.pow2(x, x_decimals), x_decimals, exp / 2);
        } else {
            return ECs.mul(x, ECs.pow(ECs.pow2(x, x_decimals), x_decimals, (exp - 1) / 2), x_decimals);
        }
    };

    /// Converts a fixed-precision number to a text representation (e.g., "123.45").
    public func toText(val: Nat, decimals: Nat8): Text {
        let b = ECs.one(decimals);
        let whole = val / b;
        let decimal = val % b;

        return Nat.toText(whole) # "." # padLeft(Nat.toText(decimal), '0', Nat8.toNat(decimals));
    };

    /// Pads a string on the left with a specified character to a total length.
    func padLeft(text: Text, pad_char: Char, total_length: Nat) : Text {
        let text_length = Text.size(text);
        if (text_length >= total_length) {
            return text;
        };
        
        let pad_length: Nat = total_length - text_length;
        let pad_string = Text.fromChar(pad_char);
        var result = "";
        
        // Create padding
        var i = 0;
        label L loop {
            if (i == pad_length) break L;
            result := result # pad_string;
            i += 1;
        };
        
        // Concatenate padding and original text
        return result # text;
    }
}