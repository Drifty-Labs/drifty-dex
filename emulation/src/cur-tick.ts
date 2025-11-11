import { WithdrawResult } from "./amm.ts";
import { InventoryTick, ReserveTick } from "./liquidity.ts";
import { TickIndex } from "./ticks.ts";
import { panic } from "./utils.ts";

export type AMMSwapDirection = "reserve -> inventory" | "inventory -> reserve";

export type CurrentTickSwapArgs = {
    direction: AMMSwapDirection;
    qtyIn: number;
};

export type CurrentTickSwapResult = {
    qtyOut: number;
    reminderIn: number;
};

export class CurrentTick {
    private targetReserve: number = 0;
    private currentReserve: number = 0;

    private targetInventory: number = 0;
    private currentInventory: number = 0;

    public swap(args: CurrentTickSwapArgs): CurrentTickSwapResult {
        if (args.direction === "reserve -> inventory") {
            const needsInventory = args.qtyIn * this.idx.getPrice();

            if (needsInventory <= this.currentInventory) {
                this.currentInventory -= needsInventory;
                this.currentReserve += args.qtyIn;

                return {
                    qtyOut: needsInventory,
                    reminderIn: 0,
                };
            }

            const getsInventory = this.currentInventory;
            const reminderInventory = needsInventory - getsInventory;
            const reminderReserve = reminderInventory / this.idx.getPrice();

            this.currentInventory = 0;
            this.currentReserve += args.qtyIn - reminderReserve;

            return {
                qtyOut: getsInventory,
                reminderIn: reminderReserve,
            };
        }

        const needsReserve = args.qtyIn / this.idx.getPrice();

        if (needsReserve <= this.currentReserve) {
            this.currentReserve -= needsReserve;
            this.currentInventory += args.qtyIn;

            return {
                qtyOut: needsReserve,
                reminderIn: 0,
            };
        }

        const getsReserve = this.currentReserve;
        const reminderReserve = needsReserve - getsReserve;
        const reminderInventory = reminderReserve * this.idx.getPrice();

        this.currentReserve = 0;
        this.currentInventory += args.qtyIn - reminderInventory;

        return {
            qtyOut: getsReserve,
            reminderIn: reminderInventory,
        };
    }

    public putInventoryTick(tick: InventoryTick) {
        this.assertIsEmpty();
        if (tick.idx !== this.idx) panic("Ticks don't match");

        this.targetInventory += tick.inventory;
        this.currentInventory += tick.inventory;

        this.targetReserve = tick.respectiveReserve;
    }

    public putReserveTick(tick: ReserveTick) {
        this.assertIsEmpty();
        if (tick.idx !== this.idx) panic("Ticks don't match");

        this.targetReserve += tick.reserve;
        this.currentReserve += tick.reserve;

        this.targetInventory = this.targetReserve * this.idx.getPrice();
    }

    public deposit(reserve: number) {
        this.targetReserve += reserve;
        this.currentReserve += reserve;

        this.targetInventory = this.targetReserve * this.idx.getPrice();
    }

    public withdraw(
        depositedReserve: number,
        respectiveReserve: number
    ): WithdrawResult {
        if (this.currentReserve < depositedReserve)
            panic(
                `Not enough reserve to withdraw: have ${this.currentReserve}, want ${depositedReserve}`
            );

        const depositedInventory = respectiveReserve * this.idx.getPrice();
        if (this.currentInventory < depositedInventory)
            panic(
                `Not enough inventory to withdraw: have ${this.currentInventory}, want ${depositedInventory}`
            );

        this.currentReserve -= depositedReserve;
        this.currentInventory -= depositedInventory;

        return { reserve: depositedReserve, inventory: depositedInventory };
    }

    public decrement() {
        this.assertIsEmpty();
        this.idx.dec();
    }

    public increment() {
        this.assertIsEmpty();
        this.idx.inc();
    }

    public index(): TickIndex {
        return this.idx.clone();
    }

    private assertIsEmpty() {
        if (!this.isEmpty()) panic("Current tick is not empty");
    }

    public isEmpty() {
        return (
            this.targetReserve +
                this.targetInventory +
                this.currentReserve +
                this.currentInventory ===
            0
        );
    }

    constructor(private idx: TickIndex) {}
}
