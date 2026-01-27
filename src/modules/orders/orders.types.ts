import { OrderStatus, ServiceType } from '@prisma/client';

export type CreateOrderInput = {
    clientPhone: string;
    photoFileId?: string | null;

    // tgId того, кто принял (MASTER) и кто создал (MASTER) — в боте это обычно одно и то же,
    // но оставим гибкость
    acceptedByTgId: bigint;
    createdByTgId: bigint;

    items: Array<{
        service: ServiceType;
        price: number;
        comment?: string | null;
        warrantyDays?: number | null;
    }>;

    estimateTotal?: number | null;
};

export type AddItemsInput = {
    orderPublicId: number;
    byTgId: bigint; // кто добавляет (MASTER/ADMIN)
    items: CreateOrderInput['items'];
};

export type ChangeStatusInput = {
    orderPublicId: number;
    byTgId: bigint;
    status: OrderStatus;
};

export type FinalizeOrderInput = {
    orderPublicId: number;
    byTgId: bigint;
    finalTotal: number;
    clientEmail?: string | null;
    doneAt?: Date;
};

export type SearchOrdersInput = {
    phonePart: string;
    includeDone?: boolean;
    limit?: number;
};
