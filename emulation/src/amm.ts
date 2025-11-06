import { AMMStats } from "./utils.ts";

export class AMM {
    private totalReserve: number = 0;
    private unallocatedReserve: number = 0;
    private allocatedReserve: number = 0;
    private totalInventory: number = 0;

    public expose(reserve: number, inventory: number) {
        this.allocatedReserve -= reserve;
        this.totalInventory += inventory;
    }

    public recover(reserve: number, inventory: number) {
        this.allocatedReserve += reserve;
        this.totalInventory -= inventory;
    }

    public deallocate(qty: number) {
        this.allocatedReserve -= qty;
        this.unallocatedReserve += qty;
    }

    public allocateOnDemand(): number {
        const qty = this.unallocatedReserve * 0.01;
        this.unallocatedReserve -= qty;
        this.allocatedReserve += qty;

        return qty;
    }

    public allocateOnTimer(): number | undefined {
        const threshold = this.totalReserve * 0.99;
        if (this.unallocatedReserve < threshold) return undefined;

        return this.allocateOnDemand();
    }

    public deposit(qty: number) {
        this.totalReserve += qty;
        this.unallocatedReserve += qty;
    }

    public withdraw(depositedQty: number): {
        reserve: number;
        inventory: number;
    } {
        const share = depositedQty / this.totalReserve;
        this.totalReserve -= depositedQty;

        const allocatedReserveCut = this.allocatedReserve * share;
        const unallocatedReserveCut = this.unallocatedReserve * share;
        const inventoryCut = this.totalInventory * share;

        this.allocatedReserve -= allocatedReserveCut;
        this.unallocatedReserve -= unallocatedReserveCut;
        this.totalInventory -= inventoryCut;

        return {
            reserve: allocatedReserveCut + unallocatedReserveCut,
            inventory: inventoryCut,
        };
    }

    public stats(): AMMStats {
        return {
            reserve: {
                total: this.totalReserve,
                unallocated: this.unallocatedReserve,
                allocated: this.allocatedReserve,
            },
            inventory: {
                total: this.totalInventory,
            },
        };
    }
}
