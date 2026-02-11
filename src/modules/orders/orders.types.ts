import { OrderStatus, ServiceType } from '@prisma/client';
import { OrderWithRelations } from '../../common/interfaces';

export type CreateOrderInput = {
    clientPhone: string;
    photoFileId?: string | null;
    photoFileIds?: string[];

    // tgId mast be MASTER or ADMIN
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
    byTgId: bigint; // who add (MASTER/ADMIN)
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

export type FinalizeOrderResult = {
    order: OrderWithRelations;
    pdfBuffer: Buffer;
};

export type UpdateOrderInput = {
    orderPublicId: number;
    byTgId: bigint;
    clientPhone?: string;
    estimateTotal?: number | null;
    clientEmail?: string | null;
    photoFileId?: string | null;
    photoFileIds?: string[] | null;
};

export type ReplaceItemsInput = {
    orderPublicId: number;
    byTgId: bigint;
    items: CreateOrderInput['items'];
    estimateTotal?: number | null;
};

export type DeleteOrderInput = {
    orderPublicId: number;
    byTgId: bigint;
};

export type SearchOrdersInput = {
    phonePart: string;
    includeDone?: boolean;
    limit?: number;
};
