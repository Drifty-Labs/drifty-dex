import {test; suite; expect} "mo:test";
import ECs "../../backend/shared/ecs";

suite("ECs", func() {
    test("conversion works fine", func() {
        let pi_e8s = ECs.convert(31415, 4, 8);
        expect.nat(pi_e8s).equal(3_14150000);

        let pi_e3s = ECs.convert(pi_e8s, 8, 3);
        expect.nat(pi_e3s).equal(3_141);

        let pi_e40s = ECs.convert(pi_e3s, 3, 40);
        expect.nat(pi_e40s).equal(3_1_410_000_000_000_000_000_000_000_000_000_000_000_000);

        let pi_e0s = ECs.convert(pi_e40s, 40, 0);
        expect.nat(pi_e0s).equal(3);
    });

    test("mul/div works fine", func() {
        let a_e8s = 124_42891952;
        let b_e8s = 2919_53821715;

        let mul_e8s = ECs.mul(a_e8s, b_e8s, 8);
        expect.nat(mul_e8s).equal(363274_98585732);

        let a_div_b_e8s = ECs.div(a_e8s, b_e8s, 8);
        expect.nat(a_div_b_e8s).equal(0_04261938);

        let b_div_a_e8s = ECs.div(b_e8s, a_e8s, 8);
        expect.nat(b_div_a_e8s).equal(23_46350212);

        expect.nat(a_e8s * b_e8s / b_e8s).equal(a_e8s);
    });

    test("inv works fine", func() {
        let a_e8s = 14_28572945;
        let inv_a_e8s = ECs.inv(a_e8s, 8);

        expect.nat(inv_a_e8s).equal(0_06999992);
        
        let one = ECs.mul(a_e8s, inv_a_e8s, 8);
        let eps: Nat = 10; // 0.00000010
        let dif: Nat = ECs.one(8) - one;

        expect.nat(dif).less(eps);
    });

    test("sqrt/pow2 works fine", func() {
        let eps = 1;

        let two_e8s = ECs.one(8) * 2;
        let sqrt_two_e8s = ECs.sqrt(two_e8s, 8);
        expect.nat(sqrt_two_e8s).equal(1_41421356);
        
        let dif1: Nat = two_e8s - ECs.pow2(sqrt_two_e8s, 8);
        expect.nat(dif1).lessOrEqual(eps);

        let eighty_one_e8s = ECs.one(8) * 81;
        let sqrt_eighty_one_e8s = ECs.sqrt(eighty_one_e8s, 8);
        expect.nat(sqrt_eighty_one_e8s).equal(9_00000000);

        let dif2: Nat = eighty_one_e8s - ECs.pow2(sqrt_eighty_one_e8s, 8);
        expect.nat(dif2).lessOrEqual(eps);

        let leet_e4s = 0_1337;
        let sqrt_leet_e4s = ECs.sqrt(leet_e4s, 4);
        expect.nat(sqrt_leet_e4s).equal(0_3657);

        let dif3: Nat = leet_e4s - ECs.pow2(sqrt_leet_e4s, 4);
        expect.nat(dif3).lessOrEqual(eps);
    });

    test("pow works fine", func() {
        let two_e8s = ECs.one(8) * 2;
        let one_forth_e8s = ECs.pow(two_e8s, 8, -2); 
        expect.nat(one_forth_e8s).equal(0_25000000);

        let five_e8s = ECs.one(8) * 5;
        let _625_e8s = ECs.pow(five_e8s, 8, 4); 
        expect.nat(_625_e8s).equal(625_00000000);
    });
});