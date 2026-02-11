import {
    Order,
    OrderItem,
    OrderPhoto,
    OrderStatus,
    Prisma,
} from '@prisma/client';

/**
 * DIP (Dependency Inversion Principle)
 * Repository Pattern - data access abstraction
 */

export type OrderWithRelations = Order & {
    items: OrderItem[];
    photos?: OrderPhoto[];
    acceptedBy: { name: string | null; tgId: bigint } | null;
    createdBy: { name: string | null; tgId: bigint } | null;
    assignedTo: { name: string | null; tgId: bigint } | null;
};

export type CreateOrderData = {
    clientPhone: string;
    status: OrderStatus;
    estimateTotal: number | null;
    photoFileId: string | null;
    acceptedById: string;
    createdById: string;
    items: Array<{
        service: string;
        price: number;
        comment: string | null;
        warrantyDays: number | null;
        warrantyUntil: Date | null;
    }>;
};

export interface IOrdersRepository {
    // Low-level data access / Низькорівневий доступ до даних
    create(data: CreateOrderData): Promise<OrderWithRelations>;

    findByPublicId(publicId: number): Promise<OrderWithRelations | null>;

    findByStatus(
        status: OrderStatus,
        skip: number,
        take: number
    ): Promise<OrderWithRelations[]>;

    countByStatus(status: OrderStatus): Promise<number>;

    searchByPhone(
        phonePart: string,
        includeDone: boolean,
        limit: number
    ): Promise<OrderWithRelations[]>;

    update(
        id: string,
        data: Prisma.OrderUpdateInput
    ): Promise<OrderWithRelations>;

    groupByStatus(): Promise<Record<OrderStatus, number>>;

    addItems(
        orderId: string,
        items: Array<{
            service: string;
            price: number;
            comment: string | null;
            warrantyDays: number | null;
            warrantyUntil: Date | null;
        }>
    ): Promise<void>;

    getOrderSum(orderId: string): Promise<number | null>;

    /**
     * Transfer order to another master and update status in single transaction
     * This is a repository-level method because it's a single atomic transaction
     */
    transferAndUpdateStatus(params: {
        orderId: string;
        fromMasterId: string | null;
        toMasterId: string;
        newStatus: OrderStatus;
        transferredByTgId: bigint;
    }): Promise<void>;
}

export const ORDERS_REPOSITORY = Symbol('IOrdersRepository');
