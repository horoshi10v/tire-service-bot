import { OrderStatus } from '@prisma/client';

/**
 * Domain Events for Order operations
 *
 * Observer Pattern: Decouple order operations from notifications
 * SRP: Each event represents a single domain occurrence
 */

export class OrderCreatedEvent {
    constructor(
        public readonly orderId: string,
        public readonly publicId: number,
        public readonly clientPhone: string,
        public readonly createdByTgId: bigint
    ) {}
}

export class OrderStatusChangedEvent {
    constructor(
        public readonly orderId: string,
        public readonly publicId: number,
        public readonly fromStatus: OrderStatus,
        public readonly toStatus: OrderStatus,
        public readonly changedByTgId: bigint
    ) {}
}

export class OrderFinalizedEvent {
    constructor(
        public readonly orderId: string,
        public readonly publicId: number,
        public readonly finalTotal: number,
        public readonly clientEmail: string | null
    ) {}
}

export class OrderAssignedEvent {
    constructor(
        public readonly orderId: string,
        public readonly publicId: number,
        public readonly fromTgId: bigint | null,
        public readonly toTgId: bigint,
        public readonly assignedByTgId: bigint
    ) {}
}
